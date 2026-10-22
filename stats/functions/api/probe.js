/**
 * Data source probe (diagnostics): tests reachability of each upstream from the edge
 *   GET /api/probe
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

async function probe(name, url, opts) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    return {
      name,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      len: text.length,
      head: text.slice(0, 160).replace(/\s+/g, " "),
    };
  } catch (e) {
    return { name, ok: false, error: String((e && e.message) || e), ms: Date.now() - t0 };
  }
}

export async function onRequestGet() {
  const UA = { "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/125 Safari/537.36" };
  const results = await Promise.all([
    probe("eastmoney-kline(push2his)", "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600690&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=0&beg=20260701&end=20261031",
      { headers: { ...UA, Referer: "https://quote.eastmoney.com/" } }),
    probe("eastmoney-spot(push2)", "https://push2.eastmoney.com/api/qt/stock/get?secid=1.600690&fields=f43,f57,f58,f60,f170",
      { headers: { ...UA, Referer: "https://quote.eastmoney.com/" } }),
    probe("eastmoney-spot-2(push2his-alt)", "https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.600690,1.688139,0.300143&fields=f2,f3,f12,f14",
      { headers: { ...UA, Referer: "https://quote.eastmoney.com/" } }),
    probe("sina-kline", "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh600690&scale=240&ma=no&datalen=5",
      { headers: { ...UA, Referer: "https://finance.sina.com.cn/" } }),
    probe("sina-spot(hq)", "https://hq.sinajs.cn/list=sh600690", { headers: { ...UA, Referer: "https://finance.sina.com.cn/" } }),
    probe("tencent-spot", "https://qt.gtimg.cn/q=sh600690", { headers: { ...UA, Referer: "https://gu.qq.com/" } }),
  ]);
  return json({ ok: true, at: new Date().toISOString(), results });
}
