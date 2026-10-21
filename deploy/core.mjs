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

/** 抓三只股票并计算基准因子 */
export async function collect(fetcher = fetch) {
  const series = {};
  for (const s of STOCKS) {
    series[s.name] = await fetchKline(s.secid, fetcher);
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
    updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19) + " (UTC)",
    source: "东方财富 push2his 日K（不复权）· Cloudflare Worker",
    stocks: STOCKS.map((s) => ({ code: s.code, name: s.name })),
    records,
  };
}
