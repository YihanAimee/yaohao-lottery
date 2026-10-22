/**
 * Live factor API (served from pages.dev, reachable in China)
 *   GET /api/factor -> latest data written by the Worker (KV, updated every minute)
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
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

export async function onRequestGet({ env }) {
  if (!env || !env.FACTOR_KV) return json({ ok: false, error: "no kv" }, 500);
  const raw = await env.FACTOR_KV.get("factor:current");
  if (!raw) return json({ ok: false, message: "no data yet" }, 404);
  try {
    const data = JSON.parse(raw);
    data.origin = "实时接口（Cloudflare Worker 每分钟抓取）";
    return json(data);
  } catch (e) {
    return json({ ok: false, error: "bad kv data" }, 500);
  }
}
