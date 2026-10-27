#!/bin/bash
# 打包静态页面到 deploy/dist（Cloudflare Workers 静态资源）
# 同时同步一份到 stats/public（Cloudflare Pages 站点，绕开 GitHub Pages 的 Jekyll 构建问题）
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/deploy/dist"
rm -rf "$DIST"
mkdir -p "$DIST/data" "$DIST/parking"
cp "$ROOT/index.html" "$ROOT/app.js" "$ROOT/styles.css" "$DIST/"
cp "$ROOT/data/factors.js" "$ROOT/data/factors.json" "$ROOT/data/status.json" "$DIST/data/" 2>/dev/null || true
cp "$ROOT/parking/index.html" "$ROOT/parking/app.js" "$DIST/parking/" 2>/dev/null || true
echo "已打包到 $DIST"
ls -R "$DIST" | head -20

# 同步到 Cloudflare Pages
PAGES="$ROOT/stats/public"
mkdir -p "$PAGES/data" "$PAGES/parking" "$PAGES/stats-dashboard"
cp "$ROOT/index.html" "$ROOT/app.js" "$ROOT/styles.css" "$ROOT/track.js" "$PAGES/" 2>/dev/null || true
cp "$ROOT/data/factors.js" "$ROOT/data/factors.json" "$ROOT/data/status.json" "$PAGES/data/" 2>/dev/null || true
# 车位互换页面（公开）
cp "$ROOT/parking/index.html" "$ROOT/parking/app.js" "$PAGES/parking/" 2>/dev/null || true
# 数据分析看板（口令保护，GitHub Pages 与 Pages 各一份）
cp "$ROOT/stats-dashboard/index.html" "$ROOT/stats-dashboard/app.js" "$ROOT/stats-dashboard/styles.css" \
   "$PAGES/stats-dashboard/" 2>/dev/null || true
echo "已同步到 $PAGES"
