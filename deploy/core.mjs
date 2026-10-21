/**
 * 摇号走势图 · 云端数据核心（Cloudflare Workers / Node 均可运行）
 * 规则：收盘价小数点后两位颠倒 → 角分互换（十位=分，个位=角），三只股票拼成 6 位基准因子。
 */

export const STOCKS = [
  { code: "600690", name: "海尔智家", secid: "1.600690" },
  { code: "688139", name: "海尔生物", secid: "1.688139" },
  { code: "300143", name: "盈康生命", secid: "0.300143" },
];

const BEGIN = "20260701";
const END = "20261031";

/** 当前时间（北京时间 UTC+8），带时区偏移，避免显示歧义 */
export function bjStamp(d = new Date()) {
  // 绝对时刻 + 8 小时 = 北京墙上时间；再按 UTC 字段取，避免受运行机器时区影响
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 19) + "+08:00";
}

/** 角分互换：20.12 -> 21，27.57 -> 75，8.27 -> 72（十位=分，个位=角） */
export function jiaoFen(price) {
  const fen = Math.round((price - Math.floor(price)) * 100);
  const jiao = Math.floor(fen / 10);
  const fenGe = fen % 10;
  return { jiao, fen: fenGe, value: fenGe * 10 + jiao };
}

/** 拉取单只股票日K（不复权） */
export async function fetchKline(secid, fetcher = fetch) {
  const url =
    "https://push2his.eastmoney.com/api/qt/stock/kline/get?" +
    `secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=101&fqt=0&beg=${BEGIN}&end=${END}`;
  const res = await fetcher(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/125 Safari/537.36", Referer: "https://quote.eastmoney.com/" },
  });
  if (!res.ok) throw new Error("eastmoney http " + res.status);
  const json = await res.json();
  const d = json && json.data;
  if (!d || !d.klines) throw new Error("eastmoney empty data for " + secid);
  return {
    code: d.code,
    name: d.name,
    rows: d.klines.map((k) => {
      const p = k.split(",");
      return {
        date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4],
        volume: +p[5], amount: +p[6], amplitude: +p[7], pct: +p[8],
        change: +p[9], turnover: +p[10],
      };
    }),
  };
}

/** 备用数据源：新浪财经日K（symbol 形如 sh600690） */
export async function fetchKlineSina(symbol, fetcher = fetch) {
  const url =
    "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/" +
    `CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=200`;
  const res = await fetcher(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/125 Safari/537.36", Referer: "https://finance.sina.com.cn/" },
  });
  if (!res.ok) throw new Error("sina http " + res.status);
  const txt = await res.text();
  const rows = [];
  const blobs = txt.match(/\{[^{}]*\}/g) || [];
  const pick = (blob, key) => {
    const m = new RegExp('"' + key + '"\\s*:\\s*"?([\\d.]+)"?').exec(blob);
    return m ? Number(m[1]) : 0;
  };
  for (const blob of blobs) {
    const d = /"day"\s*:\s*"([\d-]+)"/.exec(blob);
    if (!d) continue;
    const close = pick(blob, "close");
    if (!close) continue;
    rows.push({
      date: d[1],
      open: pick(blob, "open"),
      close,
      high: pick(blob, "high"),
      low: pick(blob, "low"),
      volume: pick(blob, "volume"),
    });
  }
  if (!rows.length) throw new Error("sina empty data for " + symbol);
  // 补齐涨跌幅（新浪不返回）
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  for (let i = 0; i < rows.length; i++) {
    const prev = i > 0 ? rows[i - 1].close : 0;
    rows[i].pct = prev ? +(((rows[i].close - prev) / prev) * 100).toFixed(2) : 0;
  }
  // 与东财主源口径对齐：只保留 BEGIN 之后的交易日
  const kept = rows.filter((r) => r.date.replace(/-/g, "") >= BEGIN);
  if (!kept.length) throw new Error("sina no rows after " + BEGIN);
  return { code: symbol, name: symbol, rows: kept };
}

/** 抓三只股票并计算基准因子（东财为主源，新浪为备源） */
export async function collect(fetcher = fetch) {
  const series = {};
  const sources = {};
  const errors = [];
  for (const s of STOCKS) {
    const symbol = (s.code.startsWith("6") ? "sh" : "sz") + s.code;
    let got = null;
    try {
      got = await fetchKline(s.secid, fetcher);
      sources[s.name] = "东方财富";
    } catch (e) {
      errors.push(s.name + " 东财失败: " + (e && e.message ? e.message : e));
      got = await fetchKlineSina(symbol, fetcher);
      sources[s.name] = "新浪财经";
    }
    series[s.name] = got;
    await new Promise((r) => setTimeout(r, 300));
  }
  const names = STOCKS.map((s) => s.name);
  const byDate = {};
  for (const name of names) {
    for (const r of series[name].rows) {
      (byDate[r.date] = byDate[r.date] || {})[name] = r;
    }
  }
  const records = [];
  for (const date of Object.keys(byDate).sort()) {
    const rec = byDate[date];
    if (names.some((n) => !rec[n])) continue;
    const closes = names.map((n) => Math.round(rec[n].close * 100) / 100);
    const splits = closes.map((c) => jiaoFen(c));
    const factorStr = splits.map((s) => String(s.value).padStart(2, "0")).join("");
    const payload = { date, closes: {}, jiao: {}, fen: {}, jiaoFen: {}, pct: {} };
    names.forEach((n, i) => {
      payload.closes[n] = closes[i];
      payload.jiao[n] = splits[i].jiao;
      payload.fen[n] = splits[i].fen;
      payload.jiaoFen[n] = splits[i].value;
      payload.pct[n] = rec[n].pct;
    });
    payload.factor = parseInt(factorStr, 10);
    payload.factorStr = factorStr;
    records.push(payload);
  }
  // 位序自检：必须是「分·角」拼接
  for (const r of records) {
    const expect = names.map((n) => `${r.fen[n]}${r.jiao[n]}`).join("");
    if (r.factorStr !== expect) throw new Error("位序校验失败 " + r.date);
  }
  return {
    updatedAt: bjStamp(),
    source:
      "日K（不复权）· " +
      Object.keys(sources)
        .map((n) => n + "=" + sources[n])
        .join("、") +
      " · Cloudflare Worker",
    stocks: STOCKS.map((s) => ({ code: s.code, name: s.name })),
    records,
  };
}


/** 推送到 GitHub（Contents API 覆盖写，与 GitHub Actions 并发安全） */
export async function pushToGitHub(env, payload) {
  const token = env && env.GITHUB_TOKEN;
  const repo = (env && env.GITHUB_REPO) || "YihanAimee/yaohao-lottery";
  if (!token) return { ok: false, error: "未配置 GITHUB_TOKEN" };
  const files = {
    "data/factors.json": JSON.stringify(payload, null, 1) + "\n",
    "data/factors.js": "window.FACTOR_DATA = " + JSON.stringify(payload, null, 1) + ";\n",
    "data/status.json": JSON.stringify({
      ok: true,
      lastUpdated: payload.updatedAt,
      lastDate: payload.records[payload.records.length - 1].date,
      lastFactor: payload.records[payload.records.length - 1].factorStr,
      records: payload.records.length,
      error: null,
      host: "cloudflare-worker",
    }, null, 1) + "\n",
  };
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  for (const path of Object.keys(files)) {
    const url = "https://api.github.com/repos/" + repo + "/contents/" + path;
    let sha = null;
    const cur = await fetch(url, {
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "User-Agent": "yaohao-worker" },
    });
    if (cur.ok) {
      const j = await cur.json();
      sha = j.sha;
    }
    const body = { message: "chore: 更新基准因子数据 (Cloudflare Worker)", content: b64(files[path]), branch: "main" };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "yaohao-worker",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, error: path + " -> HTTP " + res.status + " " + (await res.text()).slice(0, 160) };
    }
  }
  return { ok: true, repo, files: Object.keys(files) };
}
