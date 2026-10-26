#!/bin/bash
# 胶囊AI · 导出后台看板数据（只读数据库，不改任何东西）
# 用法：在项目文件夹里运行  bash eval/export-dashboard.sh
cd "$(dirname "$0")/.."
node --experimental-strip-types --no-warnings eval/export-dashboard.ts
