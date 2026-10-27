-- 访问统计 · 手动归档（备用方案）
--
-- 自动归档已内置在 stats/functions/api/track.js（每天第一次埋点时自动执行一次）。
-- 本脚本用于自动归档未触发时的手工补跑，例如刚部署新表后。
--
-- 用法（在 stats/ 目录下执行）：
--   npx wrangler d1 execute yaohao-stats --remote --file=../scripts/archive_events.sql
--
-- 作用：把今天之前的明细聚合进 events_daily / events_uv_daily，然后删除这些明细，
--       使明细表始终只保留当天数据，保持小体积，避免 D1 免费版每日行读取配额被扫爆。

-- 1) 幂等建表
CREATE TABLE IF NOT EXISTS events_daily (
  day   TEXT    NOT NULL,
  type  TEXT    NOT NULL,
  el    TEXT    NOT NULL DEFAULT '',
  txt   TEXT    NOT NULL DEFAULT '',
  xb    INTEGER NOT NULL DEFAULT -1,
  yb    INTEGER NOT NULL DEFAULT -1,
  ua    TEXT    NOT NULL DEFAULT '',
  ref   TEXT    NOT NULL DEFAULT '',
  path  TEXT    NOT NULL DEFAULT '',
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, type, el, txt, xb, yb, ua, ref, path)
);

CREATE TABLE IF NOT EXISTS events_uv_daily (
  day TEXT NOT NULL,
  iph TEXT NOT NULL,
  PRIMARY KEY (day, iph)
);

-- 2) 聚合今天之前的明细（cutoff = 北京时间今天 00:00）
INSERT INTO events_daily (day, type, el, txt, xb, yb, ua, ref, path, n)
SELECT day, type, el, txt,
       CASE WHEN type='click' AND x>0 AND y>0 THEN MIN(39, CAST(x*40 AS INTEGER)) ELSE -1 END,
       CASE WHEN type='click' AND x>0 AND y>0 THEN MIN(39, CAST(y*40 AS INTEGER)) ELSE -1 END,
       ua, ref, path, COUNT(*)
  FROM events
 WHERE day < date('now', '+8 hours', 'start of day')
 GROUP BY day, type, el, txt,
       CASE WHEN type='click' AND x>0 AND y>0 THEN MIN(39, CAST(x*40 AS INTEGER)) ELSE -1 END,
       CASE WHEN type='click' AND x>0 AND y>0 THEN MIN(39, CAST(y*40 AS INTEGER)) ELSE -1 END,
       ua, ref, path
ON CONFLICT(day, type, el, txt, xb, yb, ua, ref, path) DO UPDATE SET n = n + excluded.n;

-- 3) 归档每日去重访客
INSERT OR IGNORE INTO events_uv_daily (day, iph)
SELECT DISTINCT day, iph FROM events
 WHERE day < date('now', '+8 hours', 'start of day') AND iph <> '';

-- 4) 删除已归档的明细
DELETE FROM events WHERE day < date('now', '+8 hours', 'start of day');
