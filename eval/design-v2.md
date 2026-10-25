# Capsight v2 · design (Harper)

- **Author:** LI YISHA (Harper, the operator). Written and handed to AI on **19 October 2026, 20:58 SGT**, after reviewing Batch A.
- **Why:** Batch A showed wrong official sites and one-line pricing. Yisa's own check of monday.com/pricing (screenshot, 19 Oct) showed what a complete answer looks like.
- **Implemented by AI (Aiden)** on 19 Oct 2026 in server/src (intent, collect, facts, run) and web/src, with 35 automated tests passing (39 after v2.1, 43 after v2.2, 46 after v2.3).

## What was implemented as designed
- Intent classification stays a separate step that outputs JSON only; two branches: A = user does not know competitors (list + basic introduction), B = user names them (full modules).
- Edge cases from this design are now worked examples and tests: "我做 AI 表单 SaaS，竞品有哪些？帮我看看其中 Typeform 的定价" → B (Typeform only); "客户管理系统有哪些？随便介绍下" → A.
- Retrieval is driven by code, not by the model. Missing information is written as 「暂无公开信息」.
- Pricing follows the SaaS template: plans & prices, pricing unit, billing, extra costs, free tier & trial, current offer.

## Where the build differs from the design, and why
- **Verification by code, not only by prompt.** The design asks the model to use only the reference material. The build keeps v1's stronger rule: every value, and every pricing slot separately, must quote text that the program finds on the source page, or it is not shown.
- **Output is a verified table, not a free-text report.** Each module is a column and each pricing slot its own checked fact, so each one can be audited and exported to CSV.
- **Official-site check added** (not in the design, required by Batch A): the model may suggest an official domain, but the domain is only used once search results or the site itself confirm it. Directory, download and news sites are never accepted.
- **Not built yet:** intent confidence score and asking the user back when confidence is low (left for after Gate 2).

## v2.1 · 20 October 2026 · official-site sources (Harper's request after reading the Batch A site accuracy)
- Batch A by situation: English question + English brand 10/13; Chinese question + Chinese brand 3/7; Chinese question + English brand 4/11, because Chinese search often lists no official site for English brands at all.
- Yisa asked how to raise this and chose three changes on 20 Oct, 13:47 SGT: (1) Google's knowledge-graph website, (2) Wikidata's official-website property, (3) an English Google search for every brand with a Latin-script name or alias.
- Order used: knowledge graph → Wikidata → search results that confirm a hinted domain → hinted domain checked on the site → a domain that is exactly the brand → (only when the model gave no domain) a weaker match → none. Each step's answer is cross-checked (the panel must be about this brand; Wikidata must agree with the hints or carry the brand); directory, download, review and news sites are never accepted.
- Every company records how its site was found, so Batch B reports accuracy per method.
- Left for after Gate 2: a list of official sites Harper has confirmed, and showing the detected site to the user for correction before the run.

## v2.2 · 20 October 2026 · what a general assistant does differently (Harper's review)
- Yisa compared Capsight with how a general AI assistant researches pricing: it already knows the competitors, runs one specific search per company with the points that matter in the query, prefers official pages and otherwise a dated third-party summary, and asks the page only the questions that fill the table.
- Adopted (decided by Yisa, 16:33 SGT): (1) one specific pricing search per company naming the template points and the user's own fields; (2) a dated third-party pricing page (updated within 12 months) is accepted when no official page states the price, always labelled 「第三方来源 · date」 and audited in full.
- Kept from Capsight, not adopted from the assistant: every value must quote text the program finds on the page. The assistant's own explanation of why it is accurate is not evidence; it has not been measured with the same audit.

## v2.3 · 25 October 2026 · Harper's product review of v2.2
- **Positioning narrowed to SaaS competitor research** (22:20): page copy, examples and README no longer invite schools, cities or open-source projects. Other research types come after this one works.
- **Branch A shows basic company information** (22:27): besides the introduction, every competitor found gets country/region, company size and funding, read from the official about page, web pages and news, each quoted with its year.
- **One click from A to B** (22:27): after a "find competitors" run, the user does not start over. A button carries the list and the official sites already confirmed into a details run (features, pricing template, social, news); the user can still remove competitors or fields first. Carried-over sites are not re-identified, and pages fetched in the first run are reused from the cache.

---

## Original design text (as written by Yisa)

# 整体思路
你现在的需求本质：**让Agent先识别用户属于哪一类意图分支，再路由到对应的检索+回答逻辑**，底层DeepSeek LLM只负责两件事：①意图分类；②生成结构化检索指令/最终摘要。
> 两个意图：
> 意图A：**用户不知道竞品** → 用户描述自家产品/功能/产品名，【找竞品列表】+输出竞品基础介绍（官网/百科）
> 意图B：**用户知道竞品** → 用户直接给出竞品名称，【查该竞品详情：公司+业务+产品功能+定价+近期动态】

整套方案分成 4大块：**1. 意图识别Prompt（给DeepSeek） 2. 分支路由逻辑 3. 每个分支的资料检索规则 4. 输出格式约束**，可以直接接入Agent框架。

---

## 一、第一步：给DeepSeek写【意图分类Prompt】
> 作用：接收用户原始提问，输出结构化意图结果，不要让大模型自由发挥。
> 输出格式固定为JSON（方便Agent代码解析，非常关键）
```
角色：意图分类器
任务：识别用户SaaS竞品调研查询属于下面其中一类，只输出JSON，不要多余解释。
类别定义：
类别A【不知道竞品】：用户描述自家产品、产品功能、产品赛道名称，想找到有哪些竞品；用户没有直接给出竞品名字。
类别B【知道竞品】：用户直接给出明确竞品名称，想要查询这个竞品的详细调研信息（公司、业务、功能、定价、新闻动态）

规则：
1. 只允许输出type字段，type只能是A 或者 B
2. 提取关键词：query_key（提取核心实体，用于后续检索）
3. 禁止编造信息，只基于用户输入判断

输出示例：
{"type":"A","query_key":"AI客户管理SaaS产品"}
{"type":"B","query_key":"HubSpot"}
```
✅ 调用方式：单独调用DeepSeek跑这个意图分类，拿到JSON，Agent代码读取`type`，走不同分支。

> 小优化：加边界case
> 例：用户同时说了产品+竞品名 → 判定为B；用户问“做AI表单的有哪些工具” → A。

---

## 二、第二步：Agent路由分支（核心逻辑，代码侧实现）
> 大模型只做分类，**检索动作由Agent调度搜索工具**（不要让LLM幻觉编造竞品信息！这是竞品调研最大坑）

### 分支A：type = A（用户不知道竞品，找竞品列表）
1. Agent拿到`query_key`，调用搜索工具：搜索「query_key 竞品有哪些 SaaS」
2. 对返回结果做过滤，筛选出3~5个匹配竞品（控制数量，避免太多）
3. 对每一个筛选出来的竞品，**并行检索：官网简介、百科介绍**
4. 把收集到的资料全部塞给DeepSeek，使用【分支A的回答Prompt】生成输出
> 分支A回答Prompt：
```
你是SaaS竞品调研助手。基于提供的参考资料，输出调研结果。
要求：
用户还不知道竞品，需要你列出匹配竞品清单，每个竞品只输出基础介绍（来自官网/百科）
不要深入挖掘定价、近期新闻。
格式：
## 竞品清单
1.【产品名称】
基础介绍：xxx（简述公司、产品定位）
参考资料：{检索回来的网页文本}
禁止编造资料里不存在的信息。
```

### 分支B：type = B（用户知道竞品，查详细竞品信息）
1. Agent拿到`query_key`（竞品名称），调用搜索工具，并行搜4个维度：
   - ①公司&主营业务（百科/官网About页）
   - ②产品功能
   - ③定价模式（就是你前面SaaS定价调研模板！）
   - ④近期动态（近半年社媒、第三方行业报道）
2. 收集全部检索片段，喂给DeepSeek，使用【分支B回答Prompt】
> 分支B回答Prompt：
```
你是SaaS竞品调研助手，基于参考资料输出竞品完整调研。
按照固定4个模块输出，资料没有的就写【暂无公开信息】，严禁编造：
1. 基础信息：公司介绍 + 主要业务
2. 业务信息：产品功能、定价模式（套餐、计价单位、附加成本、免费策略，使用SaaS竞品定价模板）
3. 近期动态：近半年新闻、社媒、行业报道
参考资料：{检索回来的网页片段}
```

---

## 三、工程层面的几个关键点（针对DeepSeek + Agent）
### 1. 分离「意图分类」和「内容生成」，不要一锅端
❌ 错误做法：一个Prompt让DeepSeek一边判断意图一边查资料写报告，很容易混淆两个分支，输出乱掉。
✅ 正确：串行两步
用户问题 → DeepSeek意图分类（输出JSON）→ Agent路由+工具检索 → DeepSeek生成最终报告。

### 2. 检索词模板固化，减少LLM生成搜索query的不确定性
你可以直接硬编码两套搜索模板：
- A类搜索词模板：`{query_key} SaaS 竞品列表`
- B类搜索词模板：
`{query_key} 公司介绍`
`{query_key} 产品功能`
`{query_key} 定价方案 SaaS`
`{query_key} 近期动态 行业报道`

> 可选进阶：让DeepSeek辅助优化搜索关键词，但基础模板固定兜底，防止跑偏。

### 3. 资料截断 & 引用校验（DeepSeek容易幻觉）
- 检索回来的网页原文，**强制限制大模型只能使用参考资料内容**，资料不存在写【暂无公开信息】
- 可以加一条强制指令：`所有内容必须来自参考资料，禁止猜测、编造定价/公司信息`

### 4. 边界case处理（在意图分类prompt补充）
- 用户同时两个需求：例如：“我做AI表单SaaS，竞品有哪些？帮我看看其中Typeform的定价”
→ 意图判定B，优先针对指定竞品做详情调研
- 模糊提问：“客户管理系统有哪些？随便介绍下” → A类，输出竞品清单+基础简介

---

## 四、可选进阶优化（提升效果）
1. **Few-shot示例加到意图Prompt**
在意图分类Prompt里加2-3条例子，DeepSeek意图准确率会明显提升：
```
例子1
用户输入：我做AI文档解析SaaS，有什么竞品？
输出：{"type":"A","query_key":"AI文档解析SaaS"}

例子2
用户输入：介绍一下HubSpot的定价和产品功能
输出：{"type":"B","query_key":"HubSpot"}
```

2. 增加**意图置信度**（可选）
输出JSON增加confidence，当置信度低于0.8，Agent走兜底：反问用户确认需求：
> “你是想查找这个赛道有哪些竞品，还是想查询某个特定竞品的详细信息？”
JSON样例：`{"type":"A","query_key":"AI表单SaaS","confidence":0.92}`

3. 缓存：已经查询过的竞品信息缓存，减少重复搜索、减少耗时和token消耗

---

# 最简整体流程图
用户提问
↓
DeepSeek意图分类（A/B）
↓
Agent判断分支
├─A（不知道竞品）：搜索赛道竞品列表 → 批量获取各竞品百科/官网简介 → DeepSeek生成竞品清单（仅基础介绍）
└─B（知道竞品）：搜索【公司/功能/定价/近期动态】→ DeepSeek生成完整4维度竞品调研报告

如果你需要，我可以：
1. 把整套Prompt合并成可以直接复制到你的Agent系统的完整版本；
2. 或者给你一段伪代码，演示整个调用链路。