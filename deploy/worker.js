/**
 * Cloudflare Worker: 摇号走势图
 *   GET  /api/factor   -> 返回最新基准因子数据（KV）
 *   GET  /api/cron     -> 手动触发抓取（需 Authorization: Bearer <CRON_SECRET>）
 *   其他路径            -> 静态资源（dist/ 目录）
 * 定时: 每天 UTC 07:02 与 07:12（= 北京时间 15:02 / 15:12）
 */
import { collect } from "./core.mjs";

const KV_KEY = "factor:current";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

async function refresh(env) {
  try {
    const data = await collect();
    if (env && env.FACTOR_KV) {
      await env.FACTOR_KV.put(KV_KEY, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 30 });
    }
    const last = data.records[data.records.length - 1];
    return { ok: true, records: data.records.length, lastFactor: last.factorStr, updatedAt: data.updatedAt };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/factor") {
      if (env && env.FACTOR_KV) {
        const raw = await env.FACTOR_KV.get(KV_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          data.origin = "Cloudflare Worker";
          return json(data);
        }
      }
      return json({ ok: false, message: "尚无云端数据，请先触发 /api/cron" }, 404);
    }

    if (path === "/api/cron" || path === "/api/refresh") {
      const secret = env && env.CRON_SECRET;
      const auth = request.headers.get("Authorization") || "";
      const token = url.searchParams.get("token") || auth.replace(/^Bearer\s+/i, "");
      if (secret && token !== secret) return json({ ok: false, error: "unauthorized" }, 401);
      const r = await refresh(env);
      return json(r, r.ok ? 200 : 500);
    }

    if (path === "/api/health") {
      let has = false;
      if (env && env.FACTOR_KV) has = !!(await env.FACTOR_KV.get(KV_KEY));
      return json({ ok: true, kv: has, time: new Date().toISOString() });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },
};
