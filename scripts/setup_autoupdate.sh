#!/bin/bash
# 一键安装/卸载 launchd 定时任务（数据刷新 + 本地网页服务）
# 用法:
#   bash scripts/setup_autoupdate.sh install
#   bash scripts/setup_autoupdate.sh uninstall
#   bash scripts/setup_autoupdate.sh status
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
REFRESH_LABEL="com.yaohao.refresh"
SERVE_LABEL="com.yaohao.serve"
GUI="gui/$(id -u)"

mkdir -p "$AGENTS" "$ROOT/logs"

install_plist() {
  src="$1"
  dst="$AGENTS/$(basename "$src")"
  sed "s|__ROOT__|$ROOT|g" "$src" > "$dst"
  echo "已生成 $dst"
}

do_install() {
  install_plist "$ROOT/scripts/$REFRESH_LABEL.plist"
  install_plist "$ROOT/scripts/$SERVE_LABEL.plist"
  launchctl bootout "$GUI/$SERVE_LABEL" 2>/dev/null || true
  launchctl bootstrap "$GUI" "$AGENTS/$SERVE_LABEL.plist" && echo "OK 网页服务已启动: http://127.0.0.1:8777/index.html"
  launchctl bootout "$GUI/$REFRESH_LABEL" 2>/dev/null || true
  launchctl bootstrap "$GUI" "$AGENTS/$REFRESH_LABEL.plist" && echo "OK 定时任务已装载: 交易日 15:02 与 15:12 自动抓取"
}

do_uninstall() {
  launchctl bootout "$GUI/$REFRESH_LABEL" 2>/dev/null && echo "OK 已卸载定时任务" || echo "- 定时任务未运行"
  launchctl bootout "$GUI/$SERVE_LABEL" 2>/dev/null && echo "OK 已卸载网页服务" || echo "- 网页服务未运行"
  rm -f "$AGENTS/$REFRESH_LABEL.plist" "$AGENTS/$SERVE_LABEL.plist"
}

do_status() {
  echo "== launchd 任务状态 =="
  launchctl list | grep -E "$REFRESH_LABEL|$SERVE_LABEL" || echo "(未装载)"
  echo
  echo "== 最近一次数据 =="
  if [ -f "$ROOT/data/status.json" ]; then cat "$ROOT/data/status.json"; else echo "尚无数据"; fi
  echo
  echo "== 刷新日志(末尾 20 行) =="
  if [ -f "$ROOT/logs/refresh.log" ]; then tail -20 "$ROOT/logs/refresh.log"; else echo "尚无日志"; fi
}

case "${1:-status}" in
  install) do_install ;;
  uninstall) do_uninstall ;;
  status) do_status ;;
  *) echo "用法: bash scripts/setup_autoupdate.sh [install|uninstall|status]"; exit 1 ;;
esac
