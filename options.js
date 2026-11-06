const STORAGE_KEY = "focusGuardSettings";
const DEFAULT_SITES = ["x.com", "twitter.com", "youtube.com", "youtu.be", "facebook.com"];
const TYPE_LABELS = {
  domain: "ドメイン（サブドメインも含む）",
  exact: "ドメイン完全一致",
  contains: "部分一致",
  regex: "正規表現"
};
const PLACEHOLDERS = {
  domain: "youtube.com",
  exact: "youtube.com",
  contains: "shorts",
  regex: "^https://(www\\.)?youtube\\.com/watch"
};

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

async function saveSettings(settings) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  await chrome.runtime.sendMessage({ type: "UPDATE_RULES" });
}

function showMessage(text) {
  const message = document.getElementById("message");
  message.textContent = text;
  setTimeout(() => {
    if (message.textContent === text) message.textContent = "";
  }, 2400);
}

// 保存済みの1行を、画面の行（種類・パターン・除外）に戻す。
function lineToRow(line) {
  const parsed = parseRuleLine(line);
  if (parsed) {
    return { type: parsed.type, pattern: parsed.pattern, exclude: parsed.exclude };
  }
  // 解釈できない行も消さずに、ドメイン扱いで表示して直してもらう。
  return { type: "domain", pattern: String(line || "").trim(), exclude: false };
}

function createRow(row = { type: "domain", pattern: "", exclude: false }) {
  const item = document.createElement("div");
  item.className = "ruleRow";

  const type = document.createElement("select");
  type.className = "ruleType";
  type.setAttribute("aria-label", "照合のしかた");
  for (const value of RULE_TYPES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = TYPE_LABELS[value];
    type.append(option);
  }
  type.value = row.type;

  const pattern = document.createElement("input");
  pattern.type = "text";
  pattern.className = "rulePattern";
  pattern.spellcheck = false;
  pattern.setAttribute("aria-label", "URL・パターン");
  pattern.value = row.pattern;
  pattern.placeholder = PLACEHOLDERS[row.type];

  const excludeLabel = document.createElement("label");
  excludeLabel.className = "ruleExclude";
  const exclude = document.createElement("input");
  exclude.type = "checkbox";
  exclude.checked = Boolean(row.exclude);
  excludeLabel.append(exclude, document.createTextNode("除外"));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "subtle ruleRemove";
  remove.textContent = "削除";
  remove.setAttribute("aria-label", "この行を削除");

  const error = document.createElement("p");
  error.className = "ruleError";

  type.addEventListener("change", () => {
    pattern.placeholder = PLACEHOLDERS[type.value];
    error.textContent = "";
  });
  pattern.addEventListener("input", () => { error.textContent = ""; });
  remove.addEventListener("click", () => item.remove());

  item.append(type, pattern, excludeLabel, remove, error);
  return item;
}

function renderRows(lines) {
  const list = document.getElementById("ruleList");
  list.replaceChildren(...lines.map((line) => createRow(lineToRow(line))));
}

// 画面の行を読み取り、検証する。問題があれば行にエラーを出して null を返す。
async function collectLines() {
  const lines = [];
  let hasError = false;

  for (const item of document.querySelectorAll(".ruleRow")) {
    const type = item.querySelector(".ruleType").value;
    let pattern = item.querySelector(".rulePattern").value.trim();
    const exclude = item.querySelector(".ruleExclude input").checked;
    const error = item.querySelector(".ruleError");
    error.textContent = "";
    if (!pattern) continue;

    // 正規表現を /.../ で囲んで入力した場合は外す。
    if (type === "regex" && pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/")) {
      pattern = pattern.slice(1, -1);
    }

    const line = serializeRule({ type, pattern, exclude });
    const parsed = parseRuleLine(line);
    if (!parsed || parsed.type !== type) {
      error.textContent = type === "regex"
        ? "正規表現の書き方が正しくありません。"
        : type === "contains"
          ? "文字列を入力してください。"
          : "ドメインとして読み取れません（例: youtube.com）。";
      hasError = true;
      continue;
    }

    if (type === "regex" && chrome.declarativeNetRequest && chrome.declarativeNetRequest.isRegexSupported) {
      const result = await chrome.declarativeNetRequest.isRegexSupported({ regex: pattern, isCaseSensitive: false });
      if (!result.isSupported) {
        error.textContent = result.reason === "memoryLimitExceeded"
          ? "正規表現が複雑すぎてChromeで使えません。"
          : "Chromeでは使えない書き方が含まれています（先読み・後読み・後方参照などは使えません）。";
        hasError = true;
        continue;
      }
    }
    lines.push(line);
  }
  return hasError ? null : lines;
}

async function load() {
  const settings = await getSettings();
  document.getElementById("enabled").checked = settings.enabled !== false;
  renderRows(settings.sites);
}

document.getElementById("addRule").addEventListener("click", () => {
  const row = createRow();
  document.getElementById("ruleList").append(row);
  row.querySelector(".rulePattern").focus();
});

document.getElementById("save").addEventListener("click", async () => {
  const sites = await collectLines();
  if (!sites) {
    showMessage("赤字の行を直してから保存してください。");
    return;
  }
  const settings = await getSettings();
  const enabled = document.getElementById("enabled").checked;
  const pauseUntil = enabled ? getActivePauseUntil(settings) : null;
  await saveSettings({ enabled, sites, pauseUntil });
  renderRows(sites);
  showMessage("保存しました。");
});

document.getElementById("reset").addEventListener("click", async () => {
  await saveSettings({ enabled: true, sites: DEFAULT_SITES });
  await load();
  showMessage("初期値に戻しました。");
});

load();
