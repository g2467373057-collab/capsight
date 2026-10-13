import type { Lang, SourceKind } from '../api/types'

// Demo data — illustrative only. Replace with the real backend via VITE_API_BASE.

type L = Record<Lang, string>

export interface MockSource {
  kind: SourceKind
  url: string
  title: L
}

export interface MockFact {
  value: L
  sources: MockSource[]
}

export interface MockNews {
  daysAgo: number
  text: L
  source: MockSource
}

export interface MockCompetitor {
  name: string
  aliases: string[]
  domain: string
  region: MockFact
  features: MockFact
  pricing: MockFact
  contact: MockFact
  social: MockFact
  posts: MockNews[]
  socialKey: L
  news: MockNews[]
}

const site = (url: string, zh: string, en: string): MockSource => ({ kind: 'site', url, title: { zh, en } })
const seo = (q: string, rank: number): MockSource => ({
  kind: 'seo',
  url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  title: { zh: `搜索「${q}」排名第 ${rank}`, en: `Ranks #${rank} for “${q}”` },
})
const social = (url: string, zh: string, en: string): MockSource => ({ kind: 'social', url, title: { zh, en } })
const gnews = (name: string): MockSource => ({
  kind: 'news',
  url: `https://news.google.com/search?q=${encodeURIComponent(name)}`,
  title: { zh: `新闻检索 · ${name}`, en: `News search · ${name}` },
})

function make(c: {
  name: string
  aliases: string[]
  domain: string
  region: L
  features: L
  pricing: L
  contactPath: string
  contact: L
  handle: string
  socialKey: L
  linkedin: string
  news: { daysAgo: number; text: L; path: string }[]
}): MockCompetitor {
  const home = `https://${c.domain}`
  return {
    name: c.name,
    aliases: c.aliases,
    domain: c.domain,
    region: {
      value: c.region,
      sources: [
        site(`${home}/about`, '官网 · 关于我们', 'Website · About'),
        social(`https://www.linkedin.com/company/${c.linkedin}`, 'LinkedIn 公司主页', 'LinkedIn company page'),
      ],
    },
    features: {
      value: c.features,
      sources: [site(`${home}/product`, '官网 · 产品页', 'Website · Product'), seo(`${c.name} features`, 1)],
    },
    pricing: {
      value: c.pricing,
      sources: [site(`${home}/pricing`, '官网 · 定价页', 'Website · Pricing'), seo(`${c.name} pricing`, 1)],
    },
    contact: {
      value: c.contact,
      sources: [site(`${home}${c.contactPath}`, '官网 · 联系页', 'Website · Contact')],
    },
    social: {
      value: { zh: `X ${c.handle} · 要点：${c.socialKey.zh}`, en: `X ${c.handle} · Key point: ${c.socialKey.en}` },
      sources: [
        social(`https://x.com/${c.handle.replace('@', '')}`, `X 账号 ${c.handle}`, `X account ${c.handle}`),
        social(`https://www.linkedin.com/company/${c.linkedin}`, 'LinkedIn 公司主页', 'LinkedIn company page'),
      ],
    },
    socialKey: c.socialKey,
    posts: [
      { daysAgo: 2, text: c.socialKey, source: social(`https://x.com/${c.handle.replace('@', '')}`, `X ${c.handle}`, `X ${c.handle}`) },
      {
        daysAgo: 9,
        text: { zh: '分享客户案例和团队动态', en: 'Shared a customer story and team news' },
        source: social(`https://www.linkedin.com/company/${c.linkedin}/posts/`, 'LinkedIn', 'LinkedIn'),
      },
      { daysAgo: 21, text: c.news[0]?.text ?? c.socialKey, source: social(`https://x.com/${c.handle.replace('@', '')}`, `X ${c.handle}`, `X ${c.handle}`) },
    ],
    news: c.news.map((n) => ({
      daysAgo: n.daysAgo,
      text: n.text,
      source: n.path ? site(`${home}${n.path}`, '官网 · 更新日志', 'Website · Changelog') : gnews(c.name),
    })),
  }
}

export const COMPETITORS: MockCompetitor[] = [
  make({
    name: 'Notion',
    aliases: ['notion'],
    domain: 'notion.com',
    region: { zh: '美国 · 旧金山', en: 'United States · San Francisco' },
    features: { zh: '文档、知识库、项目管理、AI 助手', en: 'Docs, wiki, projects, AI assistant' },
    pricing: { zh: 'Free / Plus / Business / Enterprise，按成员计费', en: 'Free / Plus / Business / Enterprise, per member' },
    contactPath: '/contact-sales',
    contact: { zh: '官网销售咨询表单', en: 'Sales enquiry form on website' },
    handle: '@NotionHQ',
    socialKey: { zh: '近期内容集中在 AI 功能和模板', en: 'recent posts focus on AI features and templates' },
    linkedin: 'notionhq',
    news: [
      { daysAgo: 4, text: { zh: '发布新版本更新说明', en: 'Published new release notes' }, path: '/releases' },
      { daysAgo: 52, text: { zh: '媒体报道其 AI 功能更新', en: 'Press coverage of AI feature update' }, path: '' },
    ],
  }),
  make({
    name: 'Coda',
    aliases: ['coda'],
    domain: 'coda.io',
    region: { zh: '美国 · 加利福尼亚', en: 'United States · California' },
    features: { zh: '文档 + 表格 + 自动化（Packs）', en: 'Docs + tables + automation (Packs)' },
    pricing: { zh: 'Free / Pro / Team / Enterprise，按 Doc Maker 计费', en: 'Free / Pro / Team / Enterprise, per Doc Maker' },
    contactPath: '/contact',
    contact: { zh: '官网联系表单 · 销售咨询', en: 'Contact form · sales enquiry' },
    handle: '@coda_hq',
    socialKey: { zh: '以模板分享和用户案例为主', en: 'mostly templates and customer stories' },
    linkedin: 'coda-hq',
    news: [
      { daysAgo: 12, text: { zh: '更新 Packs 集成目录', en: 'Updated Packs integration gallery' }, path: '/packs' },
      { daysAgo: 80, text: { zh: '媒体报道其企业版动态', en: 'Press coverage of enterprise plan news' }, path: '' },
    ],
  }),
  make({
    name: 'ClickUp',
    aliases: ['clickup', 'click up'],
    domain: 'clickup.com',
    region: { zh: '美国 · 圣地亚哥', en: 'United States · San Diego' },
    features: { zh: '任务、文档、白板、目标、AI', en: 'Tasks, docs, whiteboards, goals, AI' },
    pricing: { zh: 'Free Forever / Unlimited / Business / Enterprise，按用户计费', en: 'Free Forever / Unlimited / Business / Enterprise, per user' },
    contactPath: '/contact',
    contact: { zh: '官网联系页 · 销售与支持', en: 'Contact page · sales & support' },
    handle: '@clickup',
    socialKey: { zh: '主推效率技巧和新功能演示', en: 'productivity tips and feature demos' },
    linkedin: 'clickup-app',
    news: [
      { daysAgo: 6, text: { zh: '发布产品更新日志', en: 'Shipped product changelog' }, path: '/changelog' },
      { daysAgo: 35, text: { zh: '媒体报道其 AI 产品线', en: 'Press coverage of its AI line-up' }, path: '' },
    ],
  }),
  make({
    name: 'Airtable',
    aliases: ['airtable'],
    domain: 'airtable.com',
    region: { zh: '美国 · 旧金山', en: 'United States · San Francisco' },
    features: { zh: '在线数据库、界面搭建、自动化', en: 'Online database, interface builder, automations' },
    pricing: { zh: 'Free / Team / Business / Enterprise Scale', en: 'Free / Team / Business / Enterprise Scale' },
    contactPath: '/contact-sales',
    contact: { zh: '官网销售咨询表单', en: 'Sales enquiry form on website' },
    handle: '@airtable',
    socialKey: { zh: '多为客户案例和产品教程', en: 'customer stories and product tutorials' },
    linkedin: 'airtable',
    news: [
      { daysAgo: 20, text: { zh: '官网发布新功能介绍', en: 'New feature announced on website' }, path: '/whats-new' },
      { daysAgo: 120, text: { zh: '媒体报道其企业客户进展', en: 'Press coverage of enterprise adoption' }, path: '' },
    ],
  }),
  make({
    name: 'monday.com',
    aliases: ['monday', 'monday.com'],
    domain: 'monday.com',
    region: { zh: '以色列 · 特拉维夫', en: 'Israel · Tel Aviv' },
    features: { zh: '工作管理、CRM、研发协作', en: 'Work management, CRM, dev collaboration' },
    pricing: { zh: 'Free / Basic / Standard / Pro / Enterprise，按席位档计费', en: 'Free / Basic / Standard / Pro / Enterprise, seat tiers' },
    contactPath: '/contact-us',
    contact: { zh: '官网联系页 · 销售咨询', en: 'Contact page · sales enquiry' },
    handle: '@mondaydotcom',
    socialKey: { zh: '以产品发布和客户活动为主', en: 'product launches and customer events' },
    linkedin: 'mondaydotcom',
    news: [
      { daysAgo: 9, text: { zh: '媒体报道其最新产品发布', en: 'Press coverage of latest launch' }, path: '' },
      { daysAgo: 64, text: { zh: '官网更新产品路线说明', en: 'Product roadmap update on website' }, path: '/w/whats-new' },
    ],
  }),
  make({
    name: 'Asana',
    aliases: ['asana'],
    domain: 'asana.com',
    region: { zh: '美国 · 旧金山', en: 'United States · San Francisco' },
    features: { zh: '项目与任务管理、目标、工作流', en: 'Projects & tasks, goals, workflows' },
    pricing: { zh: 'Personal / Starter / Advanced / Enterprise', en: 'Personal / Starter / Advanced / Enterprise' },
    contactPath: '/sales',
    contact: { zh: '官网销售咨询页', en: 'Sales page on website' },
    handle: '@asana',
    socialKey: { zh: '偏重团队协作方法和活动预告', en: 'teamwork tips and event promos' },
    linkedin: 'asana',
    news: [
      { daysAgo: 15, text: { zh: '官网发布功能更新', en: 'Feature update posted on website' }, path: '/whats-new' },
      { daysAgo: 95, text: { zh: '媒体报道其 AI 工作流功能', en: 'Press coverage of AI workflows' }, path: '' },
    ],
  }),
]

/** Competitors suggested when the user asks about their own company. */
export const SUGGESTED_FOR_OWN = ['Notion', 'Coda', 'ClickUp', 'Airtable']

export const DEFAULT_NAMED = ['Notion', 'Coda', 'ClickUp']
