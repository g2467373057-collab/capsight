# 胶囊AI · Capsight

> 吃下一颗，就看清局面。 / Take one. See the whole field.

免费的 AI 竞品调研助手：一句话提问 → 多源抓取（官网 / SEO / 新闻 / 社媒）→ 事实校验 → AI 自检重查 → 字段整理 → 导出 CSV。

## 目录

- `Capsight.html`：单文件预览，双击即可用浏览器打开（演示数据）。
- `web/`：网站前端（Vite + React + TypeScript）。
- `server/`：后端 API（Node.js + TypeScript，无第三方依赖），负责真实抓取、校验和账号。

## 快速开始

```bash
# 只看前端（演示数据）
cd web && npm install && npm run dev            # http://localhost:5173

# 前后端一起：先在 server/keys.env 填好 Key
cd server && npm run dev                        # http://localhost:8787
cd ../web && VITE_API_BASE=http://localhost:8787 npm run dev
```

部署和 Key 清单见 `server/README.md`。

© 2026 yisa. All rights reserved.
