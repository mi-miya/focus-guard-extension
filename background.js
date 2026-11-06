importScripts("rules.js");

const DEFAULT_SITES = ["x.com", "twitter.com", "youtube.com", "youtu.be", "facebook.com"];
const STORAGE_KEY = "focusGuardSettings";
const STATS_KEY = "focusGuardStats";
const PAUSE_ALARM_NAME = "focusGuardPauseUntil";
let updateRulesQueue = Promise.resolve();

async function getSettings() {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = data[STORAGE_KEY];
  if (!settings) {
    return { enabled: true, sites: DEFAULT_SITES, pauseUntil: null };
  }
  return {
    enabled: settings.enabled !== false,
    sites: Array.isArray(settings.sites) ? settings.sites : DEFAULT_SITES,
    pauseUntil: Number.isFinite(settings.pauseUntil) ? settings.pauseUntil : null
  };
}

function isPaused(settings) {
  return Boolean(settings.pauseUntil && settings.pauseUntil > Date.now());
}

async function setPauseAlarm(pauseUntil) {
  await chrome.alarms.clear(PAUSE_ALARM_NAME);
  if (pauseUntil && pauseUntil > Date.now()) {
    await chrome.alarms.create(PAUSE_ALARM_NAME, { when: pauseUntil });
  }
}

async function createRules(lines) {
  const rules = lines.map(parseRuleLine).filter(Boolean);
  const seen = new Set();
  const dnrRules = [];

  for (const rule of rules) {
    const condition = ruleToCondition(rule);
    if (!condition) continue;

    // Chromeが扱えない正規表現（RE2非対応の書き方など）が1つでもあると全ルールの登録に失敗するので除いておく。
    if (condition.regexFilter) {
      const result = await chrome.declarativeNetRequest.isRegexSupported({
        regex: condition.regexFilter,
        isCaseSensitive: false
      });
      if (!result.isSupported) {
        console.warn("Unsupported regex skipped:", condition.regexFilter, result.reason);
        continue;
      }
    }

    const dedupeKey = JSON.stringify([rule.exclude, condition]);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    dnrRules.push({
      id: dnrRules.length + 1,
      // 除外ルールはブロックより優先させる。
      priority: rule.exclude ? 2 : 1,
      action: rule.exclude
        ? { type: "allow" }
        : { type: "redirect", redirect: { extensionPath: "/blocked.html" } },
      condition: {
        ...condition,
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"]
      }
    });
  }
  return dnrRules;
}

function formatDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRecentDateKeys(days, now = Date.now()) {
  const keys = [];
  for (let offset = 0; offset < days; offset += 1) {
    keys.push(formatDateKey(now - offset * 24 * 60 * 60 * 1000));
  }
  return keys;
}

function getSiteKey(site) {
  if (site.type === "contains") return `~${site.pattern}`;
  if (site.type === "regex") return `/${site.pattern}/`;
  if ((site.host === "x.com" || site.host === "twitter.com") && site.path === "/") {
    return "x-twitter/";
  }
  if ((site.host === "youtube.com" || site.host === "youtu.be") && site.path === "/") {
    return "youtube/";
  }
  return `${site.host}${site.path}`;
}

function getSiteLabel(site) {
  if (site.type === "contains") return `「${site.pattern}」を含むURL`;
  if (site.type === "regex") return `正規表現 /${site.pattern}/`;
  if ((site.host === "youtube.com" || site.host === "youtu.be") && site.path === "/") return "YouTube";
  if ((site.host === "x.com" || site.host === "twitter.com") && site.path === "/") return "X / Twitter";
  if (site.host === "facebook.com" && site.path === "/") return "Facebook";
  return site.path === "/" ? site.host : `${site.host}${site.path}`;
}

function mergeStatEntries(primaryEntry, secondaryEntry) {
  if (!secondaryEntry) return primaryEntry;
  const merged = primaryEntry || {
    key: secondaryEntry.key,
    label: secondaryEntry.label,
    days: {},
    total: 0,
    lastAt: null,
    lastUrl: ""
  };

  for (const [dateKey, count] of Object.entries(secondaryEntry.days || {})) {
    merged.days[dateKey] = (merged.days[dateKey] || 0) + count;
  }
  merged.total = (merged.total || 0) + (secondaryEntry.total || 0);
  if (!merged.lastAt || (secondaryEntry.lastAt && secondaryEntry.lastAt > merged.lastAt)) {
    merged.lastAt = secondaryEntry.lastAt;
    merged.lastUrl = secondaryEntry.lastUrl;
  }
  return merged;
}

function migrateCombinedStatGroup(stats, combinedKey, combinedLabel, sourceKeys) {
  const combinedKeys = [combinedKey, ...sourceKeys];
  const existingCombinedEntries = combinedKeys.map((key) => stats.sites[key]).filter(Boolean);
  if (!existingCombinedEntries.length) return;

  let mergedEntry = null;
  for (const entry of existingCombinedEntries) {
    mergedEntry = mergeStatEntries(mergedEntry, entry);
  }
  mergedEntry.key = combinedKey;
  mergedEntry.label = combinedLabel;
  mergedEntry.days = pruneOldDays(mergedEntry.days);

  stats.sites[combinedKey] = mergedEntry;
  for (const sourceKey of sourceKeys) {
    delete stats.sites[sourceKey];
  }

  if (stats.latest && combinedKeys.includes(stats.latest.key)) {
    stats.latest = summarizeAttempt(mergedEntry);
  }
  if (stats.latestByTabId) {
    for (const [tabId, latest] of Object.entries(stats.latestByTabId)) {
      if (latest && combinedKeys.includes(latest.key)) {
        stats.latestByTabId[tabId] = summarizeAttempt(mergedEntry);
      }
    }
  }
}

function migrateCombinedStats(stats) {
  if (!stats || !stats.sites) return stats;

  migrateCombinedStatGroup(stats, "x-twitter/", "X / Twitter", ["x.com/", "twitter.com/"]);
  migrateCombinedStatGroup(stats, "youtube/", "YouTube", ["youtube.com/", "youtu.be/"]);
  return stats;
}

function pruneOldDays(days) {
  const keepDays = new Set(getRecentDateKeys(90));
  return Object.fromEntries(
    Object.entries(days || {}).filter(([dateKey]) => keepDays.has(dateKey))
  );
}

function summarizeAttempt(entry, now = Date.now()) {
  const days = entry.days || {};
  const todayKey = formatDateKey(now);
  const yesterdayKey = formatDateKey(now - 24 * 60 * 60 * 1000);
  const weekKeys = new Set(getRecentDateKeys(7, now));
  const weekCount = Object.entries(days)
    .filter(([dateKey]) => weekKeys.has(dateKey))
    .reduce((total, [, count]) => total + count, 0);
  // 直近7日を古い順（左）→新しい順（右）で並べ、blocked.html のミニ推移に使う。
  const recentDays = getRecentDateKeys(7, now)
    .slice()
    .reverse()
    .map((dateKey) => ({ date: dateKey, count: days[dateKey] || 0 }));

  return {
    key: entry.key,
    label: entry.label,
    url: entry.lastUrl,
    lastAt: entry.lastAt,
    todayCount: days[todayKey] || 0,
    yesterdayCount: days[yesterdayKey] || 0,
    weekCount,
    totalCount: entry.total || 0,
    recentDays
  };
}

async function recordBlockedAttempt(url, site, tabId) {
  const now = Date.now();
  const todayKey = formatDateKey(now);
  const key = getSiteKey(site);
  const data = await chrome.storage.local.get(STATS_KEY);
  const stats = migrateCombinedStats(data[STATS_KEY] || { sites: {}, latest: null, latestByTabId: {} });
  const entry = stats.sites[key] || {
    key,
    label: getSiteLabel(site),
    days: {},
    total: 0,
    lastAt: null,
    lastUrl: ""
  };

  entry.label = getSiteLabel(site);
  entry.days = pruneOldDays(entry.days);
  entry.days[todayKey] = (entry.days[todayKey] || 0) + 1;
  entry.total = (entry.total || 0) + 1;
  entry.lastAt = now;
  entry.lastUrl = url;

  stats.sites[key] = entry;
  stats.latest = summarizeAttempt(entry, now);
  stats.latestByTabId = stats.latestByTabId || {};
  if (Number.isFinite(tabId) && tabId >= 0) {
    stats.latestByTabId[String(tabId)] = stats.latest;
  }
  await chrome.storage.local.set({ [STATS_KEY]: stats });
  return stats.latest;
}

async function getLatestStats(tabId) {
  const data = await chrome.storage.local.get(STATS_KEY);
  const stats = migrateCombinedStats(data[STATS_KEY]);
  if (!stats || !stats.latest) return null;

  if (Number.isFinite(tabId) && stats.latestByTabId && stats.latestByTabId[String(tabId)]) {
    const tabLatest = stats.latestByTabId[String(tabId)];
    const tabEntry = stats.sites && stats.sites[tabLatest.key];
    return tabEntry ? summarizeAttempt(tabEntry) : tabLatest;
  }

  const entry = stats.sites && stats.sites[stats.latest.key];
  return entry ? summarizeAttempt(entry) : stats.latest;
}

async function updateRules() {
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((rule) => rule.id);
  const settings = await getSettings();
  const paused = isPaused(settings);
  const addRules = settings.enabled && !paused ? await createRules(settings.sites) : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });

  if (settings.pauseUntil && !paused) {
    settings.pauseUntil = null;
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  }
  await setPauseAlarm(settings.pauseUntil);
  await chrome.action.setBadgeText({ text: settings.enabled && !paused ? "ON" : "" });
}

function queueRulesUpdate() {
  updateRulesQueue = updateRulesQueue.then(updateRules, updateRules);
  return updateRulesQueue;
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  if (!data[STORAGE_KEY]) {
    await chrome.storage.sync.set({
      [STORAGE_KEY]: { enabled: true, sites: DEFAULT_SITES }
    });
  }
  await queueRulesUpdate();
});

chrome.runtime.onStartup.addListener(queueRulesUpdate);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PAUSE_ALARM_NAME) {
    queueRulesUpdate();
  }
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[STORAGE_KEY]) {
    queueRulesUpdate();
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;

  getSettings()
    .then((settings) => {
      if (!settings.enabled) return null;

      // 一時解除の期限が切れていたら、アラームの発火を待たずにここでブロックルールを復帰させる。
      // （MV3ではService Worker停止中にアラームが遅延・不発になることがあり、
      //  それだけに頼ると期限を過ぎてもサイトが開けてしまうため。）
      const pauseExpired = Boolean(settings.pauseUntil && settings.pauseUntil <= Date.now());
      if (pauseExpired) {
        queueRulesUpdate();
      }

      // まだ解除期間内なら何もしない。
      if (!pauseExpired && isPaused(settings)) return null;

      const matchedSite = findMatchingRule(details.url, settings.sites);
      if (!matchedSite) return null;

      // 期限切れ直後はDNRルールの再登録が間に合わないことがあるので、
      // この遷移自体もブロックページへ明示的に飛ばして確実に止める。
      if (pauseExpired && Number.isFinite(details.tabId) && details.tabId >= 0) {
        chrome.tabs
          .update(details.tabId, { url: chrome.runtime.getURL("blocked.html") })
          .catch(() => {});
      }
      return recordBlockedAttempt(details.url, matchedSite, details.tabId);
    })
    .catch((error) => console.error("Failed to record blocked attempt:", error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "UPDATE_RULES") {
    queueRulesUpdate()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message && message.type === "GET_LATEST_STATS") {
    getLatestStats(sender.tab && sender.tab.id)
      .then((stats) => sendResponse({ ok: true, stats }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message && message.type === "PAUSE_FOR") {
    getSettings()
      .then(async (settings) => {
        const durationMs = Number(message.durationMs || 0);
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
          throw new Error("解除時間が不正です。");
        }
        settings.enabled = true;
        settings.pauseUntil = Date.now() + durationMs;
        await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
        await queueRulesUpdate();
        sendResponse({ ok: true, pauseUntil: settings.pauseUntil });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message && message.type === "RESUME_NOW") {
    getSettings()
      .then(async (settings) => {
        settings.enabled = true;
        settings.pauseUntil = null;
        await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
        await queueRulesUpdate();
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
