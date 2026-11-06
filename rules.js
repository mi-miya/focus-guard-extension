// ブロック対象の1行（文字列）を解釈・照合するための共通処理。
// background.js（importScripts）と options.js（<script>）の両方から読み込む。
//
// 保存形式は従来どおり文字列の配列。行頭の記号で種類を表す。
//   youtube.com          ドメイン（サブドメインも含む）※従来の書き方そのまま
//   =youtube.com         ドメイン完全一致（www. は同じとみなす。music.youtube.com などは含まない）
//   ~youtube             部分一致（ドメイン＋パスにこの文字列を含む）
//   /^https?:\/\/x\.com/ 正規表現（URL全体に対して。大文字小文字は区別しない）
//   !music.youtube.com   先頭に ! を付けると「除外」（ブロックしない）。他の記号と組み合わせ可

const RULE_TYPES = ["domain", "exact", "contains", "regex"];

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

// 1行を { type, exclude, pattern, host?, path? } に分解する。解釈できない行は null。
function parseRuleLine(line) {
  let value = String(line || "").trim();
  if (!value || value.startsWith("#")) return null;

  let exclude = false;
  if (value.startsWith("!")) {
    exclude = true;
    value = value.slice(1).trim();
  }

  if (value.length > 2 && value.startsWith("/") && value.endsWith("/")) {
    const pattern = value.slice(1, -1);
    try {
      new RegExp(pattern, "i");
    } catch (_error) {
      return null;
    }
    return { type: "regex", exclude, pattern };
  }

  if (value.startsWith("~")) {
    const pattern = value.slice(1).trim();
    if (!pattern) return null;
    return { type: "contains", exclude, pattern };
  }

  let type = "domain";
  if (value.startsWith("=")) {
    type = "exact";
    value = value.slice(1).trim();
  }
  const site = normalizeSiteLine(value);
  if (!site) return null;
  return { type, exclude, pattern: value, host: site.host, path: site.path };
}

// { type, exclude, pattern } を保存用の1行に戻す。
function serializeRule(rule) {
  const pattern = String(rule.pattern || "").trim();
  if (!pattern) return "";
  const prefix = rule.exclude ? "!" : "";
  if (rule.type === "regex") return `${prefix}/${pattern}/`;
  if (rule.type === "contains") return `${prefix}~${pattern}`;
  if (rule.type === "exact") return `${prefix}=${pattern}`;
  return `${prefix}${pattern}`;
}

// 部分一致の照合対象。パターンに ? を含むときだけクエリまで見る（検索結果URLなどの誤爆を避けるため）。
function containsTarget(parsedUrl, pattern) {
  const base = `${parsedUrl.host}${parsedUrl.pathname}`;
  return pattern.includes("?") ? base + parsedUrl.search : base;
}

function ruleMatchesUrl(rule, parsedUrl) {
  const hostname = parsedUrl.hostname.replace(/^www\./i, "").toLowerCase();
  const pathname = parsedUrl.pathname || "/";

  if (rule.type === "domain" || rule.type === "exact") {
    const hostMatches = rule.type === "exact"
      ? hostname === rule.host
      : hostname === rule.host || hostname.endsWith(`.${rule.host}`);
    const pathMatches = rule.path === "/" || pathname === rule.path || pathname.startsWith(`${rule.path}/`);
    return hostMatches && pathMatches;
  }
  if (rule.type === "contains") {
    return containsTarget(parsedUrl, rule.pattern).toLowerCase().includes(rule.pattern.toLowerCase());
  }
  if (rule.type === "regex") {
    try {
      return new RegExp(rule.pattern, "i").test(parsedUrl.href);
    } catch (_error) {
      return false;
    }
  }
  return false;
}

// URLに当たるブロック対象を返す。除外ルールに当たる場合や、どれにも当たらない場合は null。
function findMatchingRule(url, lines) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    return null;
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) return null;

  const rules = lines.map(parseRuleLine).filter(Boolean);
  if (rules.some((rule) => rule.exclude && ruleMatchesUrl(rule, parsedUrl))) return null;
  return rules.find((rule) => !rule.exclude && ruleMatchesUrl(rule, parsedUrl)) || null;
}

// declarativeNetRequest の condition を作る（resourceTypes 以外）。
function ruleToCondition(rule) {
  if (rule.type === "domain") {
    return { urlFilter: `||${rule.host}${rule.path}` };
  }
  if (rule.type === "exact") {
    const pathPart = rule.path === "/" ? "" : escapeRegex(rule.path);
    return {
      regexFilter: `^https?://(www\\.)?${escapeRegex(rule.host)}(:[0-9]+)?${pathPart}([/?#]|$)`
    };
  }
  if (rule.type === "contains") {
    const before = rule.pattern.includes("?") ? "[^#]*" : "[^?#]*";
    return { regexFilter: `^https?://${before}${escapeRegex(rule.pattern)}` };
  }
  if (rule.type === "regex") {
    return { regexFilter: rule.pattern };
  }
  return null;
}
