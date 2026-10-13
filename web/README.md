# 胶囊AI（Capsight）· Web

免费的 AI 竞品调研助手前端（Vite + React + TypeScript）。

## 运行

```bash
npm install
npm run dev      # 本地开发，默认 http://localhost:5173
npm run build    # 生成 dist/ 用于部署
```

## 页面

- `#`（首页）：首屏 3D 小人、四段功能演示动画、免费开始
- `#login`：登录 / 注册 / 找回密码（演示模式下只在浏览器记住邮箱）
- `#app`：调研工作台（需要登录），6 步流程：识别意图 → 多源抓取 → 事实校验 → AI 自检 → 字段整理 → 导出 CSV

## 常改的地方

| 想改什么 | 文件 |
| --- | --- |
| 所有中英文文案 | `src/data/content.ts` |
| X / LinkedIn / Reddit 链接 | `src/data/site.ts` |
| 演示用的竞品数据 | `src/data/mock.ts` |
| 功能动画速度 | `src/components/Features.tsx` 顶部 `SPEED` |
| 样式 | `src/styles/global.css` |

## 接后端

设置环境变量 `VITE_API_BASE` 后，前端会改为请求真实接口：

- `POST /intent`：识别意图（`src/api/client.ts`）
- `POST /runs`：执行调研
- `POST /auth/login`、`POST /auth/register`：登录注册（`src/api/auth.ts`）

未设置时全部使用 `src/data/mock.ts` 里的演示数据。

本地联调：在 `web/` 下新建 `.env.local`，写入 `VITE_API_BASE=http://localhost:8787`，并启动 `../server`（见 `server/README.md`）。

实时进度用 SSE（`GET /runs/:id/events`）；登录状态保存在 API 设置的 HttpOnly Cookie 里。

邮件里的链接会打开 `#verify-<token>`（验证邮箱）和 `#reset-<token>`（重置密码）两个页面。
