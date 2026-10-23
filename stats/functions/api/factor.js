/**
 * Live factor API with lazy refresh (served from pages.dev, reachable in China)
 *   GET /api/factor
 * Logic: if the cached copy is older than 60s, fetch fresh quotes right here on the
 *   edge and store to D1; otherwise return the cache. This makes the data refresh
 *   independent of Cloudflare cron triggers.
 */
import { collect, pushToGitHub } from "../_lib/core.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const CACHE_MS = 60000;

/** 北京时间小时（UTC+8），>=15 表示已收盘 */
function bjHour() {
  return new Date(Date.now() + 8 * 3600000).getUTCHours();
}

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
  const db = env && env.STATS_DB;
  if (!db) return json({ ok: false, error: "no db" }, 500);
  const now = Date.now();

  let row = null;
  try {
    row = await db.prepare("SELECT ts, data FROM live WHERE k = 'factor'").first();
  } catch (e) { /* 表不存在时忽略 */ }

  if (row && row.data && now - Number(row.ts) < CACHE_MS) {
    try {
      const data = JSON.parse(row.data);
      data.origin = "实时接口（缓存，" + Math.max(0, Math.round((CACHE_MS - (now - Number(row.ts))) / 1000)) + "s 后刷新）";
      return json(data);
    } catch (e) { /* 缓存损坏则重新抓取 */ }
  }

  try {
    const data = await collect();
    await db.prepare(
      "INSERT INTO live (k, ts, data) VALUES ('factor', ?, ?) ON CONFLICT(k) DO UPDATE SET ts=excluded.ts, data=excluded.data"
    ).bind(now, JSON.stringify(data)).run();

    // 收盘后把定稿数据推送到 GitHub（内容无变化时 core.mjs 会自动跳过提交）
    if (bjHour() >= 15 && env.GITHUB_TOKEN) {
      try {
        const pushed = await pushToGitHub(env, data);
        data.pushed = pushed;
      } catch (e) {
        data.pushed = { ok: false, error: String((e && e.message) || e) };
      }
    }

    data.origin = "实时接口（刚刚抓取）";
    return json(data);
  } catch (e) {
    if (row && row.data) {
      try {
        const data = JSON.parse(row.data);
        data.origin = "实时接口（本次抓取失败，返回上次缓存）";
        data.error = String((e && e.message) || e);
        return json(data);
      } catch (e2) { /* ignore */ }
    }
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
