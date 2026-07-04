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

function formatPauseTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  });
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
    ? `${settings.sites.length}件のURLを止めています。`
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
  if (!confirm(`${label}だけNGリストを無効にします。本当にいいですか？`)) {
    return;
  }
  await sendMessage({ type: "PAUSE_FOR", durationMs });
  await render();
}

document.getElementById("pause5Button").addEventListener("click", () => {
  pauseFor(5 * 60 * 1000, "5分");
});

document.getElementById("pause60Button").addEventListener("click", () => {
  pauseFor(60 * 60 * 1000, "1時間");
});

document.getElementById("optionsButton").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

render();
