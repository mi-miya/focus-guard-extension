const STORAGE_KEY = "focusGuardSettings";
const DEFAULT_SITES = ["x.com", "twitter.com", "youtube.com", "youtu.be", "facebook.com"];

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

async function saveSettings(settings) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  await chrome.runtime.sendMessage({ type: "UPDATE_RULES" });
}

function getActivePauseUntil(settings) {
  return settings.pauseUntil && settings.pauseUntil > Date.now() ? settings.pauseUntil : null;
}

// 12時間の解除は翌日にまたぐので、日付が変わる場合だけ日付も添える。
function formatPauseTime(timestamp) {
  const end = new Date(timestamp);
  const time = end.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  });
  if (end.toDateString() === new Date().toDateString()) {
    return time;
  }
  const date = end.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  return `${date} ${time}`;
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) {
    throw new Error(response && response.error ? response.error : "操作に失敗しました。");
  }
  return response;
}

async function render() {
  const settings = await getSettings();
  const pauseUntil = getActivePauseUntil(settings);
  const statusTitle = document.getElementById("statusTitle");
  const statusText = document.getElementById("statusText");
  const toggleButton = document.getElementById("toggleButton");

  if (settings.enabled && pauseUntil) {
    statusTitle.textContent = "一時解除中";
    statusText.textContent = `${formatPauseTime(pauseUntil)}までNGリストを解除しています。`;
    toggleButton.textContent = "今すぐ再開する";
    toggleButton.classList.remove("subtle");
    return;
  }

  statusTitle.textContent = settings.enabled ? "ブロック中" : "停止中";
  statusText.textContent = settings.enabled
    ? `${settings.sites.filter((line) => !String(line).trim().startsWith("!")).length}件のURLを止めています。`
    : "今はブロックしていません。";
  toggleButton.textContent = settings.enabled ? "期限なしで停止する" : "再開する";
  toggleButton.classList.toggle("subtle", settings.enabled);
}

document.getElementById("toggleButton").addEventListener("click", async () => {
  const settings = await getSettings();
  const pauseUntil = getActivePauseUntil(settings);

  if (pauseUntil || !settings.enabled) {
    await sendMessage({ type: "RESUME_NOW" });
    await render();
    return;
  }

  if (!confirm("期限なしでNGリストを停止します。本当にいいですか？")) {
    return;
  }

  settings.enabled = false;
  settings.pauseUntil = null;
  await saveSettings(settings);
  await render();
});

async function pauseFor(durationMs, label) {
  const until = formatPauseTime(Date.now() + durationMs);
  if (!confirm(`${label}（${until}まで）NGリストを無効にします。本当にいいですか？`)) {
    return;
  }
  await sendMessage({ type: "PAUSE_FOR", durationMs });
  await render();
}

const PAUSE_PRESETS = [
  { buttonId: "pause5Button", label: "5分", durationMs: 5 * 60 * 1000 },
  { buttonId: "pause60Button", label: "1時間", durationMs: 60 * 60 * 1000 },
  { buttonId: "pause720Button", label: "12時間", durationMs: 12 * 60 * 60 * 1000 }
];

for (const preset of PAUSE_PRESETS) {
  document.getElementById(preset.buttonId).addEventListener("click", () => {
    pauseFor(preset.durationMs, preset.label);
  });
}

document.getElementById("statsButton").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
});

document.getElementById("optionsButton").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

render();
