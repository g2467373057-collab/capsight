#!/bin/bash
# 胶囊AI · 在这台 Mac 上启动最新版，并自动打开 http://localhost:8787
# 用法：bash ~/Desktop/我的项目/调研ai工具项目/start-capsight.sh     （按 Ctrl+C 关闭）
set -e
cd "$(dirname "$0")"

# 端口 8787 上如果还有旧的胶囊AI 服务，先关掉
for pid in $(lsof -ti tcp:8787 2>/dev/null); do
  if ps -o command= -p "$pid" | grep -q "src/main.ts"; then kill "$pid" 2>/dev/null || true; fi
done
sleep 1

echo "① 打包最新的网页（第一次大约 1 分钟）…"
(cd web && npm install --no-audit --no-fund --silent && VITE_API_BASE=/api npx vite build --logLevel warn)

echo "② 启动服务 …"
# 本机自用：不用邮箱验证，每天可查 50 次
(cd server && REQUIRE_EMAIL_VERIFICATION=false RUNS_PER_USER_PER_DAY="${RUNS_PER_USER_PER_DAY:-50}" exec node --no-warnings=ExperimentalWarning src/main.ts) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; echo; echo "已关闭胶囊AI。"' EXIT

for i in $(seq 1 20); do
  curl -sf http://localhost:8787/api/health >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -sf http://localhost:8787/api/health >/dev/null 2>&1; then echo "服务没有启动成功，请把上面的内容发给 Claude"; exit 1; fi

echo
echo "   ✅ 胶囊AI 已启动：http://localhost:8787"
echo "   浏览器会自动打开；这个窗口开着就能一直用，按 Ctrl+C 关闭。"
open http://localhost:8787
wait $SERVER
