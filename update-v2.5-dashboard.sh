#!/bin/bash
# 胶囊AI · v2.5：后台看板统计 + Intercom 官网修正 → 测试 → 存档推送 → 重新评分 Batch C → 导出看板数据
# 用法：bash ~/Desktop/我的项目/调研ai工具项目/update-v2.5-dashboard.sh
set -e
cd "$(dirname "$0")"

# 看板数据里有完整邮箱，绝不上传 GitHub
for pat in 'eval/dashboard/' '*.zip' 'MSI5002-*'; do grep -qxF "$pat" .gitignore 2>/dev/null || echo "$pat" >> .gitignore; done

echo "① 跑自动测试（应该全部通过）…"
if (cd server && npm test > ../eval/test-v2.5.log 2>&1); then echo "   全部通过"; else tail -30 eval/test-v2.5.log; echo "   测试没有全部通过，停在这里，请把上面的内容发给 Claude"; exit 1; fi

echo "② 存档并推送 …"
git add -A
git commit -q -m "v2.4 + v2.5: JS-rendered prices, third-party labelling, Wikidata look-alike fix (Intercom), admin dashboard tracking and export; Batch C" && echo "   已存档" || echo "   没有新改动，跳过"
if git push -q origin HEAD 2>/dev/null; then echo "   已推送到 GitHub"; else echo "   推送失败（本地存档不受影响）"; fi

echo "③ 重新评分 Batch C（智齿科技加上 zhichi.com，不重新跑）…"
bash eval/run-batch-c.sh score eval/batch-C/2026-10-25T15-37-32 || echo "   评分没跑成功，把上面的内容发给 Claude"

echo "④ 导出看板数据 …"
bash eval/export-dashboard.sh

echo "完成。接下来重新运行 start-capsight.sh（让浏览量统计生效），然后告诉 Claude「导出好了」。"
