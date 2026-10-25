#!/bin/bash
# Capsight · 一键：存档 v1 → 装 v2.2 → 跑测试 → 存档 v2.2 → 推送 GitHub → 跑 Batch B → 存档并推送结果
# 用法：在终端里运行  bash ~/Desktop/我的项目/调研ai工具项目/install-v2.2-and-run-B.sh
set -e
cd "$(dirname "$0")"
echo "项目文件夹：$(pwd)"

# git 需要知道是谁在提交（只设置这个项目，不影响别的）
git config user.name  >/dev/null 2>&1 || git config user.name  "LI YISHA"
git config user.email >/dev/null 2>&1 || git config user.email "liyisha@u.nus.edu"

# 不上传的东西：安装包，以及 Journal（课程规定 Restricted，不能放到 GitHub）
for pat in '*.zip' 'MSI5002-*'; do grep -qxF "$pat" .gitignore 2>/dev/null || echo "$pat" >> .gitignore; done

push() {
  if git remote get-url origin >/dev/null 2>&1; then
    if git push -q origin HEAD; then echo "   已推送到 GitHub：$(git remote get-url origin)"; else echo "   推送失败（多半是 GitHub 登录过期），本地存档不受影响；把上面的提示发给 Claude"; fi
  else
    echo "   这个项目还没有关联 GitHub 仓库，跳过推送"
  fi
}

echo
echo "① 存档当前版本（v1，Batch A 用的就是它）…"
git add -A
git commit -q -m "v1 as used in Batch A (19 Oct)" && echo "   已存档" || echo "   没有新改动，跳过"

echo
echo "② 装上 v2.2 …"
if [ ! -f capsight-v2.2.zip ]; then echo "   找不到 capsight-v2.2.zip，请把它放进这个文件夹再运行"; exit 1; fi
unzip -oq capsight-v2.2.zip
echo "   已解压"

echo
echo "③ 跑自动测试（应该是 43 项全部通过）…"
cd server
npm test > ../eval/test-v2.2.log 2>&1 || true
grep -E "^# (pass|fail)" ../eval/test-v2.2.log || true
if ! grep -q "^# fail 0" ../eval/test-v2.2.log; then tail -30 ../eval/test-v2.2.log; echo "   测试没有全部通过，停在这里，请把上面的内容发给 Claude"; exit 1; fi
cd ..

echo
echo "④ 存档 v2.2 …"
git add -A
git commit -q -m "v2.2: Harper design, layered official-site lookup, specific pricing search, dated third-party pricing" && echo "   已存档" || echo "   没有新改动，跳过"

echo
echo "⑤ 推送到 GitHub …"
push

echo
echo "⑥ 跑 Batch B（10 道题，约 20–30 分钟；Mac 不要合盖，窗口不要关）…"
bash eval/run-batch.sh B

echo
echo "⑦ 存档 Batch B 结果并推送 …"
git add -A
git commit -q -m "Batch B results (v2.2)" && echo "   已存档" || echo "   没有新结果，跳过"
push
echo
echo "全部完成。告诉 Claude：Batch B 跑完了。"
