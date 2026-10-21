/**
 * 访问/点击上报端点
 *   POST /api/track   { type: 'pv'|'click', path, el, txt, x, y, vw, vh }
 * 数据最小化：只存 IP 的加盐哈希（用于 UV 去重），不存原始 IP。
 */

const SALT = "yaohao-lottery-2026";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

/** 北京时间日期 YYYY-MM-DD */
function bjDay(ts) {
  return new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
}

/** 设备/浏览器简述 */
function describeUA(ua) {
  const s = String(ua || "");
  const dev = /iPhone|Android.*Mobile|Windows Phone/i.test(s) ? "手机"
    : /iPad|Android(?!.*Mobile)|Tablet/i.test(s) ? "平板" : "桌面";
  const br = /Edg\//i.test(s) ? "Edge"
    : /MicroMessenger/i.test(s) ? "微信内置"
      : /Chrome/i.test(s) ? "Chrome"
        : /Safari/i.test(s) ? "Safari"
          : /Firefox/i.test(s) ? "Firefox" : "其他";
  return dev + "·" + br;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  if (!env.STATS_DB) return json({ ok: false, error: "no db" }, 500);
  let body = {};
  try {
    // sendBeacon 发送的是 text/plain，这里统一按文本解析
    body = JSON.parse(await request.text());
  } catch (e) {
    return json({ ok: false, error: "bad json" }, 400);
  }

  const type = body.type === "click" ? "click" : "pv";
  const ts = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
  const iph = ip ? await sha(ip + SALT) : "";
  const ua = describeUA(request.headers.get("User-Agent"));
  const ref = String(body.ref || request.headers.get("Referer") || "").slice(0, 300);
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

  await env.STATS_DB.prepare(
    `INSERT INTO events (ts, day, type, path, sid, iph, ua, ref, el, txt, x, y, vw, vh)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    ts,
    bjDay(ts),
    type,
    String(body.path || "/").slice(0, 200),
    String(body.sid || "").slice(0, 40),
    iph,
    ua,
    ref,
    String(body.el || "").slice(0, 80),
    String(body.txt || "").slice(0, 60),
    num(body.x, 0),
    num(body.y, 0),
    Math.round(num(body.vw, 0)),
    Math.round(num(body.vh, 0))
  ).run();

  return json({ ok: true });
}
