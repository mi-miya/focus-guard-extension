function formatCount(count) {
  return `${Number(count || 0).toLocaleString("ja-JP")}回`;
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isFacebookStats(stats) {
  if (stats.key === "facebook.com/") return true;
  try {
    const hostname = new URL(stats.url).hostname.replace(/^www\./i, "").toLowerCase();
    return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
  } catch (_error) {
    return false;
  }
}

function updateEscapeLink(stats) {
  // Facebook のときだけ Messenger へ抜けられるボタンを出す。
  // それ以外は空白ページを開くだけで意味がないためボタンを表示しない。
  const escapeLink = document.getElementById("escapeLink");
  escapeLink.hidden = !isFacebookStats(stats);
}

function showRandomQuote() {
  const quotes = window.FOCUS_GUARD_QUOTES;
  if (!Array.isArray(quotes) || quotes.length === 0) return;

  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  document.getElementById("quoteText").textContent = `「${quote.text}」`;
  document.getElementById("quoteAuthor").textContent = `— ${quote.author}`;
}

async function loadStats() {
  const response = await chrome.runtime.sendMessage({ type: "GET_LATEST_STATS" });
  if (!response || !response.ok || !response.stats) return;

  const stats = response.stats;
  document.getElementById("blockedTitle").textContent = `${stats.label} は今は開かない設定です。`;
  document.getElementById("blockedText").textContent =
    `今日は ${stats.label} に ${formatCount(stats.todayCount)} 向かっています。ここで一呼吸。`;
  document.getElementById("todayCount").textContent = formatCount(stats.todayCount);
  document.getElementById("weekCount").textContent = formatCount(stats.weekCount);
  document.getElementById("totalCount").textContent = formatCount(stats.totalCount);
  document.getElementById("lastAttempt").textContent = `最後のアクセス: ${formatTime(stats.lastAt)}`;
  updateEscapeLink(stats);
}

showRandomQuote();

loadStats().catch(() => {
  document.getElementById("lastAttempt").textContent = "アクセス回数を読み込めませんでした。";
});
