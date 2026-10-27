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

-- 访问统计聚合表（解决 D1 免费版每日 500 万行读取配额被耗尽的问题）
-- events_daily：按天把明细预先聚合，行数约为明细的百分之一，看板只查这张表
CREATE TABLE IF NOT EXISTS events_daily (
  day   TEXT    NOT NULL,      -- 北京时间日期 YYYY-MM-DD
  type  TEXT    NOT NULL,      -- pv | click
  el    TEXT    NOT NULL DEFAULT '',   -- 元素标识
  txt   TEXT    NOT NULL DEFAULT '',   -- 元素文案
  xb    INTEGER NOT NULL DEFAULT -1,   -- 热力桶 X（0~39，-1 表示不适用）
  yb    INTEGER NOT NULL DEFAULT -1,   -- 热力桶 Y（0~39，-1 表示不适用）
  ua    TEXT    NOT NULL DEFAULT '',   -- 设备/浏览器
  ref   TEXT    NOT NULL DEFAULT '',   -- 来源
  path  TEXT    NOT NULL DEFAULT '',   -- 页面路径
  n     INTEGER NOT NULL DEFAULT 0,    -- 计数
  PRIMARY KEY (day, type, el, txt, xb, yb, ua, ref, path)
);
CREATE INDEX IF NOT EXISTS idx_agg_day  ON events_daily(day);
CREATE INDEX IF NOT EXISTS idx_agg_type ON events_daily(day, type);

-- 每日去重访客（用于精确统计区间 UV，原始 IP 只以哈希形式存在）
CREATE TABLE IF NOT EXISTS events_uv_daily (
  day  TEXT NOT NULL,
  iph  TEXT NOT NULL,
  PRIMARY KEY (day, iph)
);
CREATE INDEX IF NOT EXISTS idx_uv_day ON events_uv_daily(day);

-- 车位互换登记（地上/地下固定车位互换）
CREATE TABLE IF NOT EXISTS parking_swaps (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,       -- 登记时间戳（毫秒）
  day       TEXT    NOT NULL,       -- 北京时间日期 YYYY-MM-DD
  time      TEXT    NOT NULL,       -- 北京时间 HH:MM
  area      TEXT    NOT NULL,       -- 当前车位区域
  layer     TEXT    NOT NULL,       -- 地上 | 地下
  emp       TEXT    NOT NULL,       -- 联系人工号（8 位数字，同一工号只能有一条有效登记）
  want1     TEXT    NOT NULL,       -- 意向区域 1（必填）
  want2     TEXT    NOT NULL DEFAULT '',  -- 意向区域 2（选填，空串表示不填）
  code      TEXT    NOT NULL,       -- 防护码（4 位数字，删除/查询凭证）
  note      TEXT,                   -- 备注（选填）
  shot      BLOB,                   -- 摇中车位截图
  shot_type TEXT,                   -- 图片 MIME
  status    TEXT    NOT NULL DEFAULT 'active',  -- active | done | removed
  iph       TEXT,                   -- IP 加盐哈希（仅用于限流去重）
  matched   INTEGER NOT NULL DEFAULT 0          -- 是否已匹配到互换对象
);
CREATE INDEX IF NOT EXISTS idx_swaps_day  ON parking_swaps(day);
CREATE INDEX IF NOT EXISTS idx_swaps_emp  ON parking_swaps(emp);
CREATE INDEX IF NOT EXISTS idx_swaps_area ON parking_swaps(area);
CREATE INDEX IF NOT EXISTS idx_swaps_st   ON parking_swaps(status);
