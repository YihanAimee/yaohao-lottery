-- 摇号走势图 · 站点访问统计
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,          -- 毫秒时间戳
  day     TEXT    NOT NULL,          -- 北京时间日期 YYYY-MM-DD
  type    TEXT    NOT NULL,          -- pv | click
  path    TEXT,                      -- 页面路径
  sid     TEXT,                      -- 会话 id
  iph     TEXT,                      -- IP 的加盐哈希（仅用于 UV 去重，不存原始 IP）
  ua      TEXT,                      -- 浏览器/设备简述
  ref     TEXT,                      -- 来源
  el      TEXT,                      -- 点击元素标识
  txt     TEXT,                      -- 元素文本
  x       REAL,                      -- 点击横坐标（相对视口 0~1）
  y       REAL,                      -- 点击纵坐标（相对视口 0~1）
  vw      INTEGER,                   -- 视口宽
  vh      INTEGER                    -- 视口高
);
CREATE INDEX IF NOT EXISTS idx_events_day  ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(ts);
