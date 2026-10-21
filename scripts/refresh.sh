#!/bin/bash
# 摇号走势图 · 数据刷新任务（供 launchd / cron 调用）
# 用法: bash scripts/refresh.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="/usr/bin/python3"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/refresh.log"

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') 开始刷新 ====="
  if "$PY" "$ROOT/scripts/fetch_data.py" --quiet; then
    echo "刷新成功"
  else
    echo "刷新失败（保留旧数据）"
  fi
  echo ""
} >> "$LOG" 2>&1
