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

function renderTrend(stats) {
  const trendRow = document.getElementById("trendRow");
  const recent = Array.isArray(stats.recentDays) ? stats.recentDays : null;
  if (!recent || recent.length < 2) {
    trendRow.hidden = true;
    return;
  }

  // 直近7日の推移をスパークラインで描く。
  const counts = recent.map((day) => Number(day.count) || 0);
  const max = Math.max(1, ...counts);
  const n = counts.length;
  const points = counts
    .map((value, index) => {
      const x = 2 + (index / (n - 1)) * 104;
      const y = 29 - (value / max) * 27;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const lastX = 2 + 104;
  const lastY = 29 - (counts[n - 1] / max) * 27;

  const svg = document.getElementById("sparkline");
  svg.innerHTML =
    `<polyline class="sparkLine" points="${points}" />` +
    `<circle class="sparkDot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5" />`;

  // 昨日との比較文言。減っていれば前向きに、増えていれば気づきを促す。
  const diff = (Number(stats.todayCount) || 0) - (Number(stats.yesterdayCount) || 0);
  const text = document.getElementById("trendText");
  if (diff < 0) {
    text.innerHTML = `昨日より <b class="is-good">${Math.abs(diff)}回 少ない</b> ペースです。`;
  } else if (diff > 0) {
    text.innerHTML = `昨日より <b class="is-bad">${diff}回 多く</b> 向かっています。`;
  } else {
    text.textContent = "昨日と同じペースです。";
  }
  trendRow.hidden = false;
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
  renderTrend(stats);
  updateEscapeLink(stats);
}

showRandomQuote();

loadStats().catch(() => {
  document.getElementById("lastAttempt").textContent = "アクセス回数を読み込めませんでした。";
});
