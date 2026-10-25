import type { Dimension, IntentType, TimeRange } from '../types.ts'

/**
 * Worked examples of how a request maps to an intent.
 * Used twice: as few-shot examples in the intent prompt, and as test cases (test/unit.test.ts),
 * so a prompt change that breaks one of these rules shows up in `npm test`.
 * `competitors: null` means the system finds them (type "own").
 */
export interface IntentExample {
  query: string
  type: IntentType
  company: string | null
  /** What the user's own product does (type own only). */
  product?: string
  competitors: string[] | null
  timeRange: TimeRange
  dimensions: Dimension[]
  /** What kind of thing the subjects are. */
  topic?: string
  /** Custom fields in the user's words. */
  fields?: string[]
  /** type own: find rivals of the user's product ("competitors") or things matching a description ("list"). */
  discover?: 'competitors' | 'list'
}

export const INTENT_EXAMPLES: IntentExample[] = [
  // branch B · the user names the competitors
  { query: 'Notion 和 Coda 的定价和最新动态', type: 'named', company: null, competitors: ['Notion', 'Coda'], timeRange: '30d', dimensions: ['name', 'pricing', 'news'] },
  { query: '飞书和钉钉的基本信息', type: 'named', company: null, competitors: ['飞书', '钉钉'], timeRange: 'all', dimensions: ['name', 'overview', 'region', 'features', 'pricing'] },
  { query: '介绍一下 HubSpot 的定价和产品功能', type: 'named', company: null, competitors: ['HubSpot'], timeRange: 'all', dimensions: ['name', 'features', 'pricing'] },
  { query: 'Compare Linear and Jira pricing', type: 'named', company: null, competitors: ['Linear', 'Jira'], timeRange: 'all', dimensions: ['name', 'pricing'] },
  { query: '我们是 Capsight，竞品有 Crayon 和 Klue，查下它们的功能', type: 'named', company: 'Capsight', competitors: ['Crayon', 'Klue'], timeRange: 'all', dimensions: ['name', 'features'] },
  { query: '我做 AI 表单 SaaS，竞品有哪些？帮我看看其中 Typeform 的定价', type: 'named', company: null, competitors: ['Typeform'], timeRange: 'all', dimensions: ['name', 'pricing'] },
  { query: 'Notion 的定价和功能，顺便看下这个月的动态', type: 'named', company: null, competitors: ['Notion'], timeRange: '30d', dimensions: ['name', 'features', 'pricing', 'news'] },
  { query: 'Cursor 和 Windsurf 怎么样', type: 'named', company: null, topic: 'AI 编程工具', competitors: ['Cursor', 'Windsurf'], timeRange: 'all', dimensions: ['name', 'overview', 'region', 'features', 'pricing', 'social', 'news'] },
  // branch A · the user does not know the competitors
  { query: '我们是做在线协作文档的，帮我找竞品', type: 'own', company: null, product: '在线协作文档', competitors: null, timeRange: 'all', dimensions: ['name', 'overview'] },
  { query: '我做 AI 文档解析 SaaS，有什么竞品？', type: 'own', company: null, product: 'AI 文档解析 SaaS', competitors: null, timeRange: 'all', dimensions: ['name', 'overview'] },
  { query: 'Find competitors of Calendly', type: 'own', company: 'Calendly', product: 'online meeting scheduling software', competitors: null, timeRange: 'all', dimensions: ['name', 'overview'] },
  { query: '客户管理系统有哪些？随便介绍下', type: 'own', company: null, discover: 'list', product: '客户管理系统 CRM', topic: 'CRM SaaS', competitors: null, timeRange: 'all', dimensions: ['name', 'overview'] },
  { query: '我们是做 AI 写作的，看看竞品这个季度的动态', type: 'own', company: null, product: 'AI 写作', competitors: null, timeRange: '90d', dimensions: ['name', 'overview', 'social', 'news'] },
  { query: '我是一家做跨境电商 ERP 的公司，主要功能是多平台订单和库存管理，查竞品都有哪些，附带他们的基本信息', type: 'own', company: null, product: '跨境电商 ERP 多平台订单 库存管理', competitors: null, timeRange: 'all', dimensions: ['name', 'overview', 'region', 'features', 'pricing'] },
  { query: 'We make a scheduling app for hair salons. Who are our competitors? Include pricing.', type: 'own', company: null, product: 'scheduling app for hair salons', competitors: null, timeRange: 'all', dimensions: ['name', 'overview', 'pricing'] },
  { query: '新加坡有哪些做 AI 教育的公司？看看融资情况和成立时间', type: 'own', company: null, discover: 'list', product: '新加坡 AI 教育 公司', topic: 'AI 教育公司', competitors: null, timeRange: 'all', dimensions: ['name', 'overview'], fields: ['融资情况', '成立时间'] },
  { query: '推荐几个开源向量数据库，比较 GitHub star、开源协议和支持的语言', type: 'own', company: null, discover: 'list', product: '开源向量数据库', topic: '开源向量数据库', competitors: null, timeRange: 'all', dimensions: ['name', 'overview'], fields: ['GitHub star 数', '开源协议', '支持的编程语言'] },
  // timeframe · named subjects, activity only
  { query: '过去一个月 Figma 和 Canva 发布了什么', type: 'timeframe', company: null, competitors: ['Figma', 'Canva'], timeRange: '30d', dimensions: ['name', 'social', 'news'] },
  { query: 'Notion 最近怎么样', type: 'timeframe', company: null, competitors: ['Notion'], timeRange: '7d', dimensions: ['name', 'social', 'news'] },
  { query: 'What did Slack and Teams announce this quarter?', type: 'timeframe', company: null, competitors: ['Slack', 'Teams'], timeRange: '90d', dimensions: ['name', 'social', 'news'] },
  { query: "What's new with Figma?", type: 'timeframe', company: null, competitors: ['Figma'], timeRange: '7d', dimensions: ['name', 'social', 'news'] },
  // not companies · fields in the user's words
  { query: '对比新加坡国立大学和南洋理工大学的人工智能硕士，学费、学制和申请截止时间', type: 'named', company: null, topic: '大学硕士项目', competitors: ['新加坡国立大学 人工智能硕士', '南洋理工大学 人工智能硕士'], timeRange: 'all', dimensions: ['name'], fields: ['学费', '学制', '申请截止时间'] },
  { query: '小红书和抖音的用户规模、主要用户画像和商业化方式', type: 'named', company: null, topic: '社交内容平台', competitors: ['小红书', '抖音'], timeRange: 'all', dimensions: ['name'], fields: ['用户规模', '用户画像', '商业化方式'] },
  { query: 'Compare Tokyo and Seoul for a 5-day trip: visa rules, average hotel price, best season', type: 'named', company: null, topic: 'travel destinations', competitors: ['Tokyo', 'Seoul'], timeRange: 'all', dimensions: ['name'], fields: ['visa rules', 'average hotel price', 'best season'] },
]
