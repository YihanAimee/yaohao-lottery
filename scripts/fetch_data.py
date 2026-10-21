#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拉取三只股票日K（不复权收盘价），计算每日基准因子（角分互换：十位=分、个位=角）。

产出：
  data/factors.json  结构化数据
  data/factors.csv   表格（收盘/角/分/分角/基准因子）
  data/factors.js    页面内联数据（file:// 双击也能用）
  data/status.json   运行状态（页面轮询用：lastUpdated / lastFactor / ok）

用法：
  python3 scripts/fetch_data.py            # 正常抓取
  python3 scripts/fetch_data.py --quiet    # 静默（定时任务用）
失败时保留旧数据不动，仅在 status.json 中记录错误。
"""
import json, os, socket, sys, time, traceback, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data")
LOG_DIR = os.path.join(ROOT, "logs")

STOCKS = [
    {"code": "600690", "market": 1, "name": "海尔智家", "secid": "1.600690"},
    {"code": "688139", "market": 1, "name": "海尔生物", "secid": "1.688139"},
    {"code": "300143", "market": 0, "name": "盈康生命", "secid": "0.300143"},
]

BEGIN = "20260701"
END = "20261031"
FIELDS1 = "f1,f2,f3,f4,f5,f6"
FIELDS2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
QUIET = "--quiet" in sys.argv


def log(*a):
    if not QUIET:
        print(*a)


def atomic_write(path, content):
    """原子写入：先写临时文件再 rename，避免页面读到写了一半的 JSON。"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)


def fetch(secid, tries=3):
    url = (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get?"
        f"secid={secid}&fields1={FIELDS1}&fields2={FIELDS2}&klt=101&fqt=0&beg={BEGIN}&end={END}"
    )
    last_err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"}
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8"))
            d = data.get("data")
            if not d:
                raise RuntimeError("empty data")
            rows = []
            for k in d["klines"]:
                p = k.split(",")
                rows.append({
                    "date": p[0], "open": float(p[1]), "close": float(p[2]),
                    "high": float(p[3]), "low": float(p[4]), "volume": float(p[5]),
                    "amount": float(p[6]), "amplitude": float(p[7]), "pct": float(p[8]),
                    "change": float(p[9]), "turnover": float(p[10]),
                })
            return {"code": d["code"], "name": d["name"], "rows": rows}
        except Exception as e:                      # 网络抖动时重试
            last_err = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError("fetch %s failed: %s" % (secid, last_err))


def fetch_sina(symbol, tries=3):
    """备用数据源：新浪财经日K（symbol 形如 sh600690）"""
    import re
    url = ("https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
           f"CN_MarketData.getKLineData?symbol={symbol}&scale=240&ma=no&datalen=200")
    last_err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/"})
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode("utf-8", "ignore")
            items = re.findall(
                r'\{[^{}]*?"day\"\s*:\s*"([\d-]+)"[^{}]*?\}', txt)
            rows = []
            for m in re.finditer(
                    r'\{[^{}]*\}', txt):
                blob = m.group(0)
                d = re.search(r'"day"\s*:\s*"([\d-]+)"', blob)
                o = re.search(r'"open"\s*:\s*"?([\d.]+)"?', blob)
                c = re.search(r'"close"\s*:\s*"?([\d.]+)"?', blob)
                h = re.search(r'"high"\s*:\s*"?([\d.]+)"?', blob)
                l = re.search(r'"low"\s*:\s*"?([\d.]+)"?', blob)
                v = re.search(r'"volume"\s*:\s*"?([\d.]+)"?', blob)
                if not (d and c):
                    continue
                rows.append({
                    "date": d.group(1),
                    "open": float(o.group(1)) if o else 0.0,
                    "close": float(c.group(1)),
                    "high": float(h.group(1)) if h else 0.0,
                    "low": float(l.group(1)) if l else 0.0,
                    "volume": float(v.group(1)) if v else 0.0,
                    "amount": 0.0, "amplitude": 0.0, "pct": 0.0,
                    "change": 0.0, "turnover": 0.0,
                })
            if not rows:
                raise RuntimeError("sina empty")
            # 与东财主源口径对齐：只保留 BEGIN 之后的交易日
            rows = [r for r in rows if r["date"].replace("-", "") >= BEGIN]
            if not rows:
                raise RuntimeError("sina no rows after " + BEGIN)
            # 补齐涨跌幅（新浪不返回）
            rows.sort(key=lambda r: r["date"])
            for i, r in enumerate(rows):
                prev = rows[i - 1]["close"] if i > 0 else 0.0
                r["pct"] = round((r["close"] - prev) / prev * 100, 2) if prev else 0.0
            return {"code": symbol, "name": symbol, "rows": rows}
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError("sina failed %s: %s" % (symbol, last_err))


def jiao_fen(price):
    """角分互换：把小数点后两位颠倒。20.12 -> 21，27.57 -> 75，8.27 -> 72
    注意：互换后【十位 = 原来的分，个位 = 原来的角】，即因子位序为「分·角」。"""
    fen = int(round((price - int(price)) * 100))
    jiao, fen_ge = fen // 10, fen % 10
    return fen_ge * 10 + jiao


def jiao_fen_split(price):
    """返回 (角, 分)：19.74 -> (7, 4)"""
    fen = int(round((price - int(price)) * 100))
    return fen // 10, fen % 10


def write_status(payload, ok=True, err=None):
    st = {
        "ok": ok,
        "lastUpdated": payload.get("updatedAt") if payload else time.strftime("%Y-%m-%d %H:%M:%S"),
        "lastDate": payload["records"][-1]["date"] if payload else None,
        "lastFactor": payload["records"][-1]["factorStr"] if payload else None,
        "records": len(payload["records"]) if payload else 0,
        "error": err,
        "host": socket.gethostname(),
    }
    atomic_write(os.path.join(OUT, "status.json"),
                 json.dumps(st, ensure_ascii=False, indent=1) + "\n")
    return st


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)

    series = {}
    for s in STOCKS:
        try:
            info = fetch(s["secid"])
            log(f"{s['name']} {info['code']}: 东财 {len(info['rows'])} 条")
        except Exception as e:
            symbol = ("sh" if s["code"].startswith("6") else "sz") + s["code"]
            log(f"{s['name']} 东财不可用（{e}），改用新浪源…")
            info = fetch_sina(symbol)
            log(f"{s['name']} {info['code']}: 新浪 {len(info['rows'])} 条")
        series[s["name"]] = info
        time.sleep(0.4)

    by_date = {}
    for name, info in series.items():
        for r in info["rows"]:
            by_date.setdefault(r["date"], {})[name] = r

    names = [s["name"] for s in STOCKS]
    records = []
    for d in sorted(by_date):
        rec = by_date[d]
        if any(n not in rec for n in names):
            continue
        closes = [round(rec[n]["close"], 2) for n in names]
        factors = [jiao_fen(c) for c in closes]
        splits = [jiao_fen_split(c) for c in closes]      # (角, 分)
        factor = int("".join(str(f).zfill(2) for f in factors))
        records.append({
            "date": d,
            "closes": {n: closes[i] for i, n in enumerate(names)},
            "pct": {n: rec[n]["pct"] for n in names},
            "jiao": {n: splits[i][0] for i, n in enumerate(names)},
            "fen": {n: splits[i][1] for i, n in enumerate(names)},
            "jiaoFen": {n: factors[i] for i, n in enumerate(names)},
            "factor": factor,
            "factorStr": str(factor).zfill(6),
        })

    payload = {
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": "东方财富 push2his 日K（不复权）",
        "stocks": [{"code": s["code"], "name": s["name"]} for s in STOCKS],
        "records": records,
    }

    # 校验：因子位序必须是「分·角」
    for r in records:
        expect = "".join(f"{r['fen'][n]}{r['jiao'][n]}" for n in names)
        assert r["factorStr"] == expect, f"位序校验失败 {r['date']}: {r['factorStr']} != {expect}"

    atomic_write(os.path.join(OUT, "factors.json"),
                 json.dumps(payload, ensure_ascii=False, indent=1) + "\n")

    # CSV：分角 = 互换后两位数（十位=分，个位=角）
    head = "日期," + ",".join(f"{n}收盘,{n}角,{n}分,{n}分角" for n in names) + ",基准因子\n"
    lines = [head]
    for r in records:
        cols = [r["date"]]
        for n in names:
            cols += [f"{r['closes'][n]:.2f}", str(r["jiao"][n]), str(r["fen"][n]), f"{r['jiaoFen'][n]:02d}"]
        cols.append(r["factorStr"])
        lines.append(",".join(cols) + "\n")
    atomic_write(os.path.join(OUT, "factors.csv"), "".join(lines))

    # 内联数据（便于 file:// 直接双击打开页面）
    atomic_write(os.path.join(OUT, "factors.js"),
                 "window.FACTOR_DATA = " + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n")

    st = write_status(payload, ok=True)
    log("记录数:", len(records), "| 末次因子:", st["lastFactor"], "| 更新于:", st["lastUpdated"])
    for r in records[-3:]:
        log(" ", r["date"], [f"{r['closes'][n]:.2f}" for n in names], r["factorStr"])


if __name__ == "__main__":
    try:
        main()
    except Exception:
        err = traceback.format_exc(limit=3)
        try:
            write_status(None, ok=False, err=err.strip().splitlines()[-1])
        except Exception:
            pass
        print(err, file=sys.stderr)
        sys.exit(1)
