#!/bin/bash
# 安全导入 GitHub Token：本地保存 + 更新 Cloudflare Worker 凭据 + 验证推送
# 用法：bash scripts/import_gh_token.sh   然后粘贴 token 回车（终端不回显，不经过聊天记录）
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="$HOME/.yaohao_gh_token"
WRANGLER="$ROOT/deploy/node_modules/.bin/wrangler"
export PATH="$ROOT/deploy/node_modules/.bin:$PATH"

echo ""
echo "请粘贴你的 GitHub Token（粘贴后按回车，输入不会显示）："
read -r -s T
echo ""
if [ -z "${T:-}" ]; then
  echo "❌ 没有读到内容，已退出。"
  exit 1
fi

# 1) 校验 token 是否可用
echo "▶ 1/4 校验 token…"
if ! curl -s --max-time 20 -H "Authorization: Bearer $T" \
     -H "Accept: application/vnd.github+json" https://api.github.com/user | grep -q '"login"'; then
  echo "❌ token 无效或已被撤销，已退出（未做任何修改）。"
  exit 1
fi
echo "   ✅ token 有效"

# 2) 本地保存
echo "▶ 2/4 保存到本地 ~/.yaohao_gh_token（权限 600）…"
printf '%s' "$T" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
echo "   ✅ 已保存"

# 3) 更新 Cloudflare Worker 的 GITHUB_TOKEN secret
echo "▶ 3/4 更新 Cloudflare Worker secret GITHUB_TOKEN…"
if [ -x "$WRANGLER" ]; then
  OUT=$(cd "$ROOT/deploy" && printf '%s' "$T" | "$WRANGLER" secret put GITHUB_TOKEN 2>&1)
  if echo "$OUT" | grep -q "Success"; then
    echo "   ✅ Cloudflare secret 已更新"
  else
    echo "   ⚠️  Cloudflare secret 更新失败（不影响 GitHub 推送，可稍后重试）"
    echo "$OUT" | tail -3
  fi
else
  echo "   ⚠️  未找到 wrangler，跳过"
fi

# 4) 验证：把 data/ 推到 GitHub
echo "▶ 4/4 验证推送…"
if GITHUB_TOKEN="$T" /usr/bin/python3 "$ROOT/scripts/push_data.py"; then
  echo ""
  echo "✅ 全部完成。现在可以去 GitHub 撤销那个已经泄露的旧 token 了。"
else
  echo ""
  echo "⚠️  推送验证失败，请检查 token 的 Contents 权限是否为 Read and write。"
fi
unset T
