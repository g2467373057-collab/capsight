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
}

export const INTENT_EXAMPLES: IntentExample[] = [
  { query: 'Notion 和 Coda 的定价和最新动态', type: 'named', company: null, competitors: ['Notion', 'Coda'], timeRange: '30d', dimensions: ['name', 'pricing', 'news'] },
  { query: '飞书和钉钉的基本信息', type: 'named', company: null, competitors: ['飞书', '钉钉'], timeRange: 'all', dimensions: ['name', 'region', 'features', 'pricing', 'contact'] },
  { query: '我们是做在线协作文档的，帮我找竞品', type: 'own', company: null, product: '在线协作文档', competitors: null, timeRange: 'all', dimensions: ['name', 'region', 'features', 'pricing', 'contact', 'social', 'news'] },
  { query: '过去一个月 Figma 和 Canva 发布了什么', type: 'timeframe', company: null, competitors: ['Figma', 'Canva'], timeRange: '30d', dimensions: ['name', 'social', 'news'] },
  { query: 'Notion 最近怎么样', type: 'timeframe', company: null, competitors: ['Notion'], timeRange: '7d', dimensions: ['name', 'social', 'news'] },
  { query: '我们是做 AI 写作的，看看竞品这个季度的动态', type: 'own', company: null, product: 'AI 写作', competitors: null, timeRange: '90d', dimensions: ['name', 'social', 'news'] },
  { query: 'Compare Linear and Jira pricing', type: 'named', company: null, competitors: ['Linear', 'Jira'], timeRange: 'all', dimensions: ['name', 'pricing'] },
  { query: 'What did Slack and Teams announce this quarter?', type: 'timeframe', company: null, competitors: ['Slack', 'Teams'], timeRange: '90d', dimensions: ['name', 'social', 'news'] },
  { query: '我们是 Capsight，竞品有 Crayon 和 Klue，查下它们的功能', type: 'named', company: 'Capsight', competitors: ['Crayon', 'Klue'], timeRange: 'all', dimensions: ['name', 'features'] },
  { query: 'Notion 的定价和功能，顺便看下这个月的动态', type: 'named', company: null, competitors: ['Notion'], timeRange: '30d', dimensions: ['name', 'features', 'pricing', 'news'] },
  { query: '我是一家做跨境电商 ERP 的公司，主要功能是多平台订单和库存管理，查竞品都有哪些，附带他们的基本信息', type: 'own', company: null, product: '跨境电商 ERP 多平台订单 库存管理', competitors: null, timeRange: 'all', dimensions: ['name', 'region', 'features', 'pricing', 'contact'] },
  { query: 'We make a scheduling app for hair salons. Who are our competitors? Include pricing.', type: 'own', company: null, product: 'scheduling app for hair salons', competitors: null, timeRange: 'all', dimensions: ['name', 'pricing'] },
  { query: "What's new with Figma?", type: 'timeframe', company: null, competitors: ['Figma'], timeRange: '7d', dimensions: ['name', 'social', 'news'] },
]
