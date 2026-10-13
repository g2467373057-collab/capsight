# 胶囊AI（Capsight）· 后端 API

把前端的六步流程变成真的：**识别意图 → 多源抓取 → 事实校验 → AI 自检重查 → 字段整理 → 导出 CSV**。

- TypeScript，运行在 **Node.js ≥ 22.18**（推荐 24），**没有任何第三方依赖**：不用 `npm install`。
- 数据库是 Node 自带的 SQLite，一个文件，适合单台服务器起步。
- 测试：`npm test`（21 项，覆盖校验、自检重查、账号、安全、完整接口流程）。

## 本地运行

```bash
cd server
cp .env.example .env      # 填入 Key，本地开发把 NODE_ENV 改成 development、APP_URL 改成 http://localhost:5173
npm run dev               # http://localhost:8787
```

前端连后端：在 `web/` 下新建 `.env.local`，写一行 `VITE_API_BASE=http://localhost:8787`，再 `npm run dev`。
不设这个变量时，前端用内置演示数据，后端不需要启动。

## 每一步怎么做的

| 步骤 | 做法 | 代码 |
| --- | --- | --- |
| 1 识别意图 | 大模型把一句话拆成：类型 / 公司 / 竞品 / 时间 / 维度。“找我公司的竞品”时，模型的建议会再用搜索结果核对，只保留搜索结果里真实出现的名字 | `src/pipeline/intent.ts` |
| 2 多源抓取 | 搜索找到官网 → 抓首页、定价、关于、联系页；搜索排名（SEO 摘要）；新闻（Google News / GDELT / 博查）；从官网页脚找社媒账号，再用官方 API 读近期内容 | `src/pipeline/collect.ts` |
| 3 事实校验 | 模型抽取每个字段时必须附上**原文引用**和文档编号；程序逐条检查：来源能打开、引用的话确实在页面里出现 | `src/pipeline/facts.ts` |
| 4 AI 自检 | 第二遍模型判断“证据是否支持结论、来源是否互相矛盾”；定价和功能只有搜索摘要、没有官网来源也算不通过。不通过就重查：先直接抓官网对应页面，再换关键词搜索，最多 2 次，仍不通过就剔除 | `src/pipeline/run.ts` |
| 5 字段整理 | 统一 7 个字段；新闻挑出与该公司相关的最新一条；社媒提炼要点 | `src/pipeline/facts.ts` |
| 6 导出 CSV | 前端直接导出；后端也提供 `GET /runs/:id/csv` | `src/pipeline/csv.ts` |

## 安全与合规

- **只抓公开网页**：遵守 robots.txt；抓取时用明确的爬虫标识；每个请求有超时和大小限制。
- **防 SSRF**：每一跳重定向都检查目标，拒绝内网、本机、云服务器元数据等地址。
- **防提示注入**：网页内容只当数据，提示词明确要求模型忽略页面里的指令；最终结果必须能在原文里找到引用，否则不会写入。
- **账号**：密码用 scrypt 加盐哈希；会话 token 只存哈希；Cookie 是 HttpOnly 的；登录、注册、找回密码都有限流；所有 POST 请求检查来源域名，防跨站请求伪造（CSRF）。
- **成本**：每人每天次数上限、全站每日上限、每人同时最多 2 个调研；网页、搜索和社媒结果缓存 12 小时。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/auth/me` | 当前用户 |
| POST | `/auth/register` `/auth/login` `/auth/logout` | 注册 / 登录 / 退出 |
| POST | `/auth/verify` `/auth/verify/resend` | 邮箱验证 |
| POST | `/auth/forgot` `/auth/reset` | 找回密码 |
| GET | `/quota` | 今日已用 / 上限 |
| POST | `/intent` | `{query, lang}` → 意图 |
| POST | `/runs` | `{intent, lang}` → `{runId}` |
| GET | `/runs/:id/events` | 实时进度（SSE：`progress` / `result` / `failed`，支持断线续传） |
| GET | `/runs/:id` `/runs/:id/csv` | 结果 / CSV |
| GET | `/history` | 最近查询 |

## 部署（海内外用户都要用）

推荐起步方案：**一台香港或新加坡的云服务器**（海内外访问都较快，不需要备案），前端静态文件和 API 放在同一台机器、同一个主域名下：

1. 服务器装 Node.js 24 和 [Caddy](https://caddyserver.com)（自动 HTTPS）。
2. 前端：`cd web && VITE_API_BASE=https://api.你的域名 npm run build`，把 `web/dist` 传到 `/srv/capsight/web/dist`。
3. 后端：把 `server/` 传到 `/srv/capsight/server`，写好 `.env`，用 `deploy/capsight.service` 交给 systemd 常驻运行（或者用 `Dockerfile`）。
4. 用 `deploy/Caddyfile` 配置两个域名：`你的域名`（网站）和 `api.你的域名`（API）。
5. 备份 `data/capsight.db`（例如每天复制一份到对象存储）。

以后如果要在中国大陆机房部署，需要先办理 ICP 备案。

## 需要准备的 Key

| 用途 | 服务 | 环境变量 |
| --- | --- | --- |
| 大模型（默认） | [DeepSeek 开放平台](https://platform.deepseek.com) | `DEEPSEEK_API_KEY` |
| 大模型（海外可选） | [Anthropic Console](https://console.anthropic.com) | `ANTHROPIC_API_KEY` + `LLM_PROVIDER_EN=anthropic` |
| 搜索（海外） | [Serper](https://serper.dev)，注册送 2,500 次 | `SERPER_API_KEY` |
| 搜索（国内） | [博查开放平台](https://open.bochaai.com) | `BOCHA_API_KEY` |
| X 帖子 | [X 开发者后台](https://console.x.com)，按量计费 | `X_BEARER_TOKEN` |
| YouTube | Google Cloud 启用 YouTube Data API v3 | `YOUTUBE_API_KEY` |
| Reddit | [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) | `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` |
| 发信 | [Resend](https://resend.com)，需要验证发信域名 | `RESEND_API_KEY` / `MAIL_FROM` |

LinkedIn 和国内社媒平台（微博等）没有允许读取别家公司帖子的官方接口，目前只记录官网上列出的账号链接。
