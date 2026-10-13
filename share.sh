#!/bin/bash
# 胶囊AI · 用这台 Mac 临时分享给朋友测试
# 用法：在终端运行  bash ~/Desktop/调研ai工具项目/share.sh   按 Ctrl+C 结束分享
#
# 运行期间会自动跟随代码改动：网页文件变了会自动重新打包，后端代码变了会自动重启，
# 公网链接保持不变，朋友刷新一下页面就是最新版。只有关掉这个窗口再重新运行，链接才会换。
set -e
cd "$(dirname "$0")"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "还没装 cloudflared。先运行：brew install cloudflared   （没有 brew 的话先到 https://brew.sh 安装）"
  exit 1
fi

stop_old() {
  # stop a server left over from an earlier run (ours: node … src/main.ts on port 8787)
  for pid in $(lsof -ti tcp:8787 2>/dev/null); do
    if ps -o command= -p "$pid" | grep -q "src/main.ts"; then kill "$pid" 2>/dev/null || true; fi
  done
  pkill -f "vite build --watch" 2>/dev/null || true
  sleep 1
}
stop_old
if lsof -ti tcp:8787 >/dev/null 2>&1; then
  echo "8787 端口被别的程序占用了（不是胶囊AI 的服务）。请先关掉它，或者重启电脑后再运行本脚本。"
  exit 1
fi

echo "① 构建最新的网页…"
(cd web && npm install --no-audit --no-fund --silent && VITE_API_BASE=/api npx vite build --logLevel warn)

# keep rebuilding the web app whenever web/src changes
(cd web && VITE_API_BASE=/api exec npx vite build --watch --logLevel warn) &
WEB=$!

echo "② 启动服务（后端代码改动后会自动重启）…"
(cd server && REQUIRE_EMAIL_VERIFICATION=false RUNS_PER_DAY_GLOBAL="${RUNS_PER_DAY_GLOBAL:-100}" exec node --no-warnings=ExperimentalWarning --watch src/main.ts) &
SERVER=$!
trap 'kill $SERVER $WEB 2>/dev/null; stop_old; echo; echo "已停止分享。"' EXIT
sleep 2
curl -sf http://localhost:8787/api/health >/dev/null || { echo "服务没有启动成功，请看上面的报错。"; exit 1; }
echo "   本机地址：http://localhost:8787"

echo "③ 生成公网链接：下面出现 https://xxxx.trycloudflare.com 时，把它发给朋友。"
echo "   窗口开着期间链接不变，代码更新后刷新页面即可；Mac 不要合盖。"
caffeinate -i cloudflared tunnel --url http://localhost:8787 --no-autoupdate
