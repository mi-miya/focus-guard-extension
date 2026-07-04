const DEFAULT_SITES = ["x.com", "twitter.com", "youtube.com", "youtu.be"];
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

function normalizeSiteLine(line) {
  let value = String(line || "").trim();
  if (!value || value.startsWith("#")) return null;

  // "https://www.youtube.com/shorts" のようなURLも、"youtube.com/shorts" のような指定も受け付ける。
  value = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  value = value.split(/[?#]/)[0];
  value = value.replace(/\s+/g, "");
  value = value.replace(/\/*$/, "");

  if (!value) return null;

  const [host, ...pathParts] = value.split("/");
  if (!host || !host.includes(".")) return null;

  const path = pathParts.length ? "/" + pathParts.join("/") : "/";
  return { host: host.toLowerCase(), path };
}

function createRules(sites) {
  const filters = [...new Set(sites.map(normalizeSiteLine).filter(Boolean).map((site) => `||${site.host}${site.path}`))];
  return filters.map((urlFilter, index) => ({
    id: index + 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/blocked.html" }
    },
    condition: {
      urlFilter,
      resourceTypes: ["main_frame"]
    }
  }));
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
  return `${site.host}${site.path}`;
}

function getSiteLabel(site) {
  if (site.host === "youtube.com" || site.host === "youtu.be") return "YouTube";
  if (site.host === "x.com") return "X";
  if (site.host === "twitter.com") return "Twitter";
  return site.path === "/" ? site.host : `${site.host}${site.path}`;
}

function findMatchingSite(url, sites) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    return null;
  }

  const hostname = parsedUrl.hostname.replace(/^www\./i, "").toLowerCase();
  const pathname = parsedUrl.pathname || "/";
  const normalizedSites = sites.map(normalizeSiteLine).filter(Boolean);

  return normalizedSites.find((site) => {
    const hostMatches = hostname === site.host || hostname.endsWith(`.${site.host}`);
    const pathMatches = site.path === "/" || pathname === site.path || pathname.startsWith(`${site.path}/`);
    return hostMatches && pathMatches;
  }) || null;
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
  const weekKeys = new Set(getRecentDateKeys(7, now));
  const weekCount = Object.entries(days)
    .filter(([dateKey]) => weekKeys.has(dateKey))
    .reduce((total, [, count]) => total + count, 0);

  return {
    key: entry.key,
    label: entry.label,
    url: entry.lastUrl,
    lastAt: entry.lastAt,
    todayCount: days[todayKey] || 0,
    weekCount,
    totalCount: entry.total || 0
  };
}

async function recordBlockedAttempt(url, site, tabId) {
  const now = Date.now();
  const todayKey = formatDateKey(now);
  const key = getSiteKey(site);
  const data = await chrome.storage.local.get(STATS_KEY);
  const stats = data[STATS_KEY] || { sites: {}, latest: null, latestByTabId: {} };
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
  const stats = data[STATS_KEY];
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
  const addRules = settings.enabled && !paused ? createRules(settings.sites) : [];

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
      if (!settings.enabled || isPaused(settings)) return null;
      const matchedSite = findMatchingSite(details.url, settings.sites);
      return matchedSite ? recordBlockedAttempt(details.url, matchedSite, details.tabId) : null;
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
