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
  const escapeLink = document.getElementById("escapeLink");
  if (!isFacebookStats(stats)) {
    escapeLink.href = "about:blank";
    escapeLink.textContent = "空白ページへ移動";
    return;
  }

  escapeLink.href = "https://www.messenger.com/";
  escapeLink.textContent = "Messengerへ移動";
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

loadStats().catch(() => {
  document.getElementById("lastAttempt").textContent = "アクセス回数を読み込めませんでした。";
});
