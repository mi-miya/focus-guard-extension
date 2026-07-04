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

function getActivePauseUntil(settings) {
  return settings.pauseUntil && settings.pauseUntil > Date.now() ? settings.pauseUntil : null;
}

function parseSites(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  await chrome.runtime.sendMessage({ type: "UPDATE_RULES" });
}

async function load() {
  const settings = await getSettings();
  document.getElementById("enabled").checked = settings.enabled !== false;
  document.getElementById("sites").value = settings.sites.join("\n");
}

document.getElementById("save").addEventListener("click", async () => {
  const settings = await getSettings();
  const enabled = document.getElementById("enabled").checked;
  const sites = parseSites(document.getElementById("sites").value);
  const pauseUntil = enabled ? getActivePauseUntil(settings) : null;
  await saveSettings({ enabled, sites, pauseUntil });
  const message = document.getElementById("message");
  message.textContent = "保存しました。";
  setTimeout(() => { message.textContent = ""; }, 1800);
});

document.getElementById("reset").addEventListener("click", async () => {
  await saveSettings({ enabled: true, sites: DEFAULT_SITES });
  await load();
  const message = document.getElementById("message");
  message.textContent = "初期値に戻しました。";
  setTimeout(() => { message.textContent = ""; }, 1800);
});

load();
