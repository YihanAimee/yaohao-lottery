/**
 * 统计查询端点
 *   GET /api/stats?days=14
 * 返回：概览 / 按天 PV·UV / Top 点击元素 / Top 来源 / 设备分布 / 点击热力网格 / 最近事件
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  if (!env.STATS_DB) return json({ ok: false, error: "no db" }, 500);
  const db = env.STATS_DB;
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") || "14", 10)));
  const from = new Date(Date.now() + 8 * 3600000 - days * 86400000).toISOString().slice(0, 10);

  const [dailyR, sumR, elR, refR, uaR, pathR, heatR, recentR] = await Promise.all([
    db.prepare(`SELECT day, COUNT(*) AS pv, COUNT(DISTINCT iph) AS uv,
                       SUM(CASE WHEN type='click' THEN 1 ELSE 0 END) AS clicks
                FROM events WHERE day >= ? GROUP BY day ORDER BY day`).bind(from).all(),
    db.prepare(`SELECT COUNT(*) AS pv, COUNT(DISTINCT iph) AS uv,
                       SUM(CASE WHEN type='click' THEN 1 ELSE 0 END) AS clicks
                FROM events WHERE day >= ?`).bind(from).all(),
    db.prepare(`SELECT COALESCE(el,'') AS el, MAX(COALESCE(txt,'')) AS txt, COUNT(*) AS n
                FROM events WHERE day >= ? AND type='click'
                GROUP BY el ORDER BY n DESC LIMIT 25`).bind(from).all(),
    db.prepare(`SELECT ref, COUNT(*) AS n FROM events WHERE day >= ? AND ref <> ''
                GROUP BY ref ORDER BY n DESC LIMIT 15`).bind(from).all(),
    db.prepare(`SELECT ua, COUNT(*) AS n FROM events WHERE day >= ?
                GROUP BY ua ORDER BY n DESC LIMIT 10`).bind(from).all(),
    db.prepare(`SELECT path, COUNT(*) AS n FROM events WHERE day >= ?
                GROUP BY path ORDER BY n DESC LIMIT 10`).bind(from).all(),
    db.prepare(`SELECT CAST(x*40 AS INTEGER) AS gx, CAST(y*40 AS INTEGER) AS gy, COUNT(*) AS n
                FROM events WHERE day >= ? AND type='click' AND x > 0 AND y > 0
                GROUP BY gx, gy`).bind(from).all(),
    db.prepare(`SELECT ts, type, path, el, txt, x, y, ua, ref FROM events
                ORDER BY ts DESC LIMIT 30`).all(),
  ]);

  const daily = dailyR.results || [];
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const todayRow = daily.find(d => d.day === today) || { pv: 0, uv: 0, clicks: 0 };

  // 补齐空缺日期，方便前端画图
  const map = new Map(daily.map(d => [d.day, d]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() + 8 * 3600000 - i * 86400000).toISOString().slice(0, 10);
    const r = map.get(day);
    series.push({ day, pv: r ? r.pv : 0, uv: r ? r.uv : 0, clicks: r ? r.clicks : 0 });
  }

  return json({
    ok: true,
    days,
    from,
    summary: {
      pv: (sumR.results[0] || {}).pv || 0,
      uv: (sumR.results[0] || {}).uv || 0,
      clicks: (sumR.results[0] || {}).clicks || 0,
      todayPv: todayRow.pv || 0,
      todayUv: todayRow.uv || 0,
    },
    series,
    topElements: elR.results || [],
    topRefs: refR.results || [],
    devices: uaR.results || [],
    topPaths: pathR.results || [],
    heat: heatR.results || [],
    recent: recentR.results || [],
  });
}
