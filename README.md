# 胶囊AI · Capsight

> 吃下一颗，就看清局面。 / Take one. See the whole field.

免费的 AI 调研助手：一句话提问 → 多源抓取（官网 / 相关网页 / SEO / 新闻 / 社媒）→ 事实校验 → AI 自检重查 → 字段整理 → 导出 CSV。

不只是竞品：公司、产品、学校/项目、城市、开源项目都能查。除了通用字段（地区、功能、定价、联系方式、社媒、新闻），
还可以写任意**自定义字段**（如「学费」「融资情况」「开源协议」），AI 会按字段去搜索、读网页、核对原文出处。

## 目录

- `Capsight.html`：单文件预览，**只有演示数据**，不会调用任何 API，不要拿它给别人试用。
- `web/`：网站前端（Vite + React + TypeScript）。
- `server/`：后端 API（Node.js + TypeScript，无第三方依赖），负责真实抓取、校验和账号。

## 快速开始

```bash
# 先在 server/keys.env 填好 Key，然后：
cd server && npm run dev                        # 后端 http://localhost:8787
cd web && npm install && npm run dev            # 前端 http://localhost:5173（/api 自动转发到后端）

# 给同学用：一条命令，生成公网链接（需要 brew install cloudflared）
bash share.sh

# 只想看离线演示（内置示例数据）
cd web && VITE_API_BASE=demo npm run dev
```

部署和 Key 清单见 `server/README.md`。

© 2026 yisa. All rights reserved.
