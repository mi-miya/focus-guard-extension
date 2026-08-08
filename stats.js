const STATS_KEY = "focusGuardStats";

// カテゴリカル配色（dataviz skill の検証済みパレット）をサイト識別に割り当てる。
// 実際の色はライト/ダークで切り替わるよう style.css の CSS 変数側で定義している。
const SERIES_COUNT = 8;

// チャートの座標系（viewBox）。.chartWrap の aspect-ratio と一致させて等倍表示する。
const VIEW = { w: 640, h: 240, left: 36, right: 16, top: 12, bottom: 26 };
const PLOT_W = VIEW.w - VIEW.left - VIEW.right;
const PLOT_H = VIEW.h - VIEW.top - VIEW.bottom;
const SVG_NS = "http://www.w3.org/2000/svg";

let allSites = [];
let rangeDays = 30;

function formatDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 古い順（左）→ 今日（右）の日付キー配列。
function rangeDateKeys(days, now = Date.now()) {
  const keys = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(formatDateKey(now - offset * 24 * 60 * 60 * 1000));
  }
  return keys;
}

function shortDate(dateKey) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}

// 既知サイトを先頭に固定し、残りはラベル順。色はこの並び順に固定で割り当てる
// （= 色は順位ではなくサイト本体に紐づくので、サイトが増減しても色が入れ替わらない）。
function siteRank(key) {
  if (key === "x-twitter/") return 0;
  if (key === "youtube/") return 1;
  if (key === "facebook.com/") return 2;
  return 3;
}

function sumOnDate(dateKey) {
  return allSites.reduce((total, site) => total + (site.days[dateKey] || 0), 0);
}

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function xAt(index, count) {
  return VIEW.left + (count > 1 ? (index / (count - 1)) * PLOT_W : PLOT_W / 2);
}

function yAt(value, yMax) {
  return VIEW.top + (1 - value / yMax) * PLOT_H;
}

// 生の最大値を「きりのよい」上端に切り上げ、目盛り配列とともに返す。
// 上端がデータ最大値以上になるので、折れ線が上端をはみ出さない。
function niceScale(rawMax) {
  const steps = [1, 2, 5];
  let unit = 1;
  while (true) {
    for (const step of steps) {
      const candidate = step * unit;
      if (candidate * 4 >= rawMax) {
        const max = Math.max(candidate, Math.ceil(rawMax / candidate) * candidate);
        const ticks = [];
        for (let value = 0; value <= max + 0.0001; value += candidate) {
          ticks.push(Math.round(value));
        }
        return { max, ticks };
      }
    }
    unit *= 10;
  }
}

function renderChart() {
  const chart = document.getElementById("chart");
  chart.innerHTML = "";
  const dates = rangeDateKeys(rangeDays);
  const seriesList = allSites.map((site) => ({
    site,
    values: dates.map((dateKey) => site.days[dateKey] || 0)
  }));

  const maxValue = Math.max(1, ...seriesList.flatMap((series) => series.values));
  const scale = niceScale(maxValue);
  const yMax = scale.max;
  const ticks = scale.ticks;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${VIEW.w} ${VIEW.h}`,
    class: "chartSvg",
    role: "img",
    "aria-label": `直近${rangeDays}日のサイト別アクセス推移`
  });

  // 横グリッド線と y 目盛りラベル。
  for (const tick of ticks) {
    const y = yAt(tick, yMax);
    svg.appendChild(svgEl("line", {
      x1: VIEW.left, y1: y, x2: VIEW.w - VIEW.right, y2: y, class: "gridLine"
    }));
    const label = svgEl("text", { x: VIEW.left - 6, y: y + 3, class: "axisLabel", "text-anchor": "end" });
    label.textContent = String(tick);
    svg.appendChild(label);
  }

  // x 軸ラベル（先頭・中央・末尾のみ表示して混雑を避ける）。
  const labelIndexes = new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1]);
  for (const index of labelIndexes) {
    const label = svgEl("text", {
      x: xAt(index, dates.length),
      y: VIEW.h - 8,
      class: "axisLabel",
      "text-anchor": index === 0 ? "start" : index === dates.length - 1 ? "end" : "middle"
    });
    label.textContent = shortDate(dates[index]);
    svg.appendChild(label);
  }

  // サイトごとの折れ線＋末尾のマーカー。
  seriesList.forEach((series) => {
    const points = series.values
      .map((value, index) => `${xAt(index, dates.length)},${yAt(value, yMax)}`)
      .join(" ");
    svg.appendChild(svgEl("polyline", {
      points,
      class: "seriesLine",
      style: `stroke: var(--series-${series.site.colorSlot})`
    }));
    const lastIndex = series.values.length - 1;
    svg.appendChild(svgEl("circle", {
      cx: xAt(lastIndex, dates.length),
      cy: yAt(series.values[lastIndex], yMax),
      r: 3.5,
      class: "seriesDot",
      style: `fill: var(--series-${series.site.colorSlot})`
    }));
  });

  // ホバー用のクロスヘア。
  const crosshair = svgEl("line", { class: "crosshair", y1: VIEW.top, y2: VIEW.top + PLOT_H, x1: 0, x2: 0 });
  crosshair.style.opacity = "0";
  svg.appendChild(crosshair);

  chart.appendChild(svg);
  setupHover(svg, dates, seriesList, yMax, crosshair);
}

function setupHover(svg, dates, seriesList, yMax, crosshair) {
  const tooltip = document.getElementById("tooltip");
  const wrap = document.getElementById("chart");

  function hide() {
    crosshair.style.opacity = "0";
    tooltip.hidden = true;
  }

  svg.addEventListener("mousemove", (event) => {
    const rect = svg.getBoundingClientRect();
    const frac = (event.clientX - rect.left) / rect.width;
    const plotFrac = (frac * VIEW.w - VIEW.left) / PLOT_W;
    const index = Math.round(Math.min(1, Math.max(0, plotFrac)) * (dates.length - 1));

    const x = xAt(index, dates.length);
    crosshair.setAttribute("x1", x);
    crosshair.setAttribute("x2", x);
    crosshair.style.opacity = "1";

    const rows = seriesList
      .map((series) => {
        const value = series.values[index];
        return `<div class="tipRow"><span class="tipSwatch" style="background: var(--series-${series.site.colorSlot})"></span>${series.site.label}<span class="tipNum">${value}</span></div>`;
      })
      .join("");
    tooltip.innerHTML = `<div class="tipDate">${shortDate(dates[index])}</div>${rows}`;
    tooltip.hidden = false;

    // ツールチップを該当点の近くに水平配置（左右端でははみ出さないよう寄せる）。
    const leftPct = (x / VIEW.w) * 100;
    tooltip.style.left = `${leftPct}%`;
    tooltip.style.transform = leftPct > 60 ? "translate(-100%, 0)" : "translate(0, 0)";
    wrap.classList.add("has-hover");
  });

  svg.addEventListener("mouseleave", () => {
    hide();
    wrap.classList.remove("has-hover");
  });
}

function renderLegend() {
  const legend = document.getElementById("legend");
  legend.innerHTML = allSites
    .map(
      (site) =>
        `<span class="legendItem"><span class="legendSwatch" style="background: var(--series-${site.colorSlot})"></span>${site.label}</span>`
    )
    .join("");
}

function renderTable() {
  const body = document.getElementById("siteTableBody");
  const todayKey = formatDateKey(Date.now());
  const yesterdayKey = formatDateKey(Date.now() - 24 * 60 * 60 * 1000);
  const weekKeys = new Set(rangeDateKeys(7));

  body.innerHTML = allSites
    .map((site) => {
      const week = Object.entries(site.days)
        .filter(([dateKey]) => weekKeys.has(dateKey))
        .reduce((total, [, count]) => total + count, 0);
      return `<tr>
        <th scope="row"><span class="legendSwatch" style="background: var(--series-${site.colorSlot})"></span>${site.label}</th>
        <td class="num">${site.days[todayKey] || 0}</td>
        <td class="num">${site.days[yesterdayKey] || 0}</td>
        <td class="num">${week}</td>
        <td class="num">${site.total || 0}</td>
      </tr>`;
    })
    .join("");
}

function renderHero() {
  const todayKey = formatDateKey(Date.now());
  const yesterdayKey = formatDateKey(Date.now() - 24 * 60 * 60 * 1000);
  const today = sumOnDate(todayKey);
  const yesterday = sumOnDate(yesterdayKey);
  const diff = today - yesterday;

  document.getElementById("heroToday").textContent = `${today}回`;
  const delta = document.getElementById("heroDelta");
  delta.classList.remove("is-good", "is-bad", "is-flat");
  if (diff < 0) {
    delta.textContent = `▼ ${Math.abs(diff)}回 減`;
    delta.classList.add("is-good");
  } else if (diff > 0) {
    delta.textContent = `▲ ${diff}回 増`;
    delta.classList.add("is-bad");
  } else {
    delta.textContent = "±0 横ばい";
    delta.classList.add("is-flat");
  }
}

function renderAll() {
  const hasData = allSites.some((site) => (site.total || 0) > 0);
  document.getElementById("emptyState").hidden = hasData;
  document.querySelector(".chartFigure").hidden = !hasData;
  document.querySelector(".tableWrap").hidden = !hasData;
  document.querySelector(".rangeRow").hidden = !hasData;
  document.querySelector(".heroRow").hidden = !hasData;
  if (!hasData) return;

  renderHero();
  renderLegend();
  renderTable();
  renderChart();
}

async function load() {
  const data = await chrome.storage.local.get(STATS_KEY);
  const stats = data[STATS_KEY];
  const sites = stats && stats.sites ? Object.values(stats.sites) : [];

  allSites = sites
    .map((site) => ({
      key: site.key,
      label: site.label || site.key,
      days: site.days || {},
      total: site.total || 0
    }))
    .sort((a, b) => siteRank(a.key) - siteRank(b.key) || a.label.localeCompare(b.label, "ja"))
    .map((site, index) => ({ ...site, colorSlot: (index % SERIES_COUNT) + 1 }));

  renderAll();
}

document.querySelectorAll(".rangeButton").forEach((button) => {
  button.addEventListener("click", () => {
    rangeDays = Number(button.dataset.days);
    document.querySelectorAll(".rangeButton").forEach((other) => other.classList.remove("is-active"));
    button.classList.add("is-active");
    renderChart();
  });
});

load().catch((error) => {
  console.error("記録の読み込みに失敗しました:", error);
  document.getElementById("emptyState").hidden = false;
  document.getElementById("emptyState").textContent = "記録を読み込めませんでした。";
});
