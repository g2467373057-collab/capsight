import { CUSTOM_PREFIX, type Dimension, type Lang, type PricingSlot, type SiteMethod } from '../types.ts'

export const DIM_LABEL: Record<Lang, Record<Dimension, string>> = {
  zh: { name: '名称', overview: '公司介绍', region: '国家/地区', size: '公司规模', funding: '融资情况', features: '功能', pricing: '定价', contact: '联系方式', social: '社媒账号', news: '最新动态' },
  en: { name: 'Name', overview: 'Overview', region: 'Country / region', size: 'Company size', funding: 'Funding', features: 'Features', pricing: 'Pricing', contact: 'Contact', social: 'Social', news: 'Latest news' },
}

export const SLOT_LABEL: Record<Lang, Record<PricingSlot, string>> = {
  zh: { plans: '套餐与单价', unit: '计价单位', billing: '计费方式', addons: '附加成本', free: '免费策略', promo: '当前优惠' },
  en: { plans: 'Plans & prices', unit: 'Pricing unit', billing: 'Billing', addons: 'Extra costs', free: 'Free tier & trial', promo: 'Current offer' },
}

export const SITE_METHOD_LABEL: Record<Lang, Record<SiteMethod, string>> = {
  zh: { google_kg: 'Google 知识图谱', wikidata: 'Wikidata', search_hint: '搜索结果 + 模型提示', hint_verified: '模型提示 + 打开网站核实', search_domain: '搜索结果（域名即品牌）', search_weak: '搜索结果（弱匹配）', given: '沿用上一轮确认的官网' },
  en: { google_kg: 'Google knowledge graph', wikidata: 'Wikidata', search_hint: 'search results + model hint', hint_verified: 'model hint, checked on the site', search_domain: 'search results (brand domain)', search_weak: 'search results (weak match)', given: 'carried over from the previous run' },
}

/** No public information for this field (wording from the v2 design). */
export const NO_INFO: Record<Lang, string> = { zh: '暂无公开信息', en: 'No public information' }

/** Header for a column key: built-in label, a pricing slot (`pricing.unit`), or the custom field's own words. */
export function colLabel(lang: Lang, key: string): string {
  if (key.startsWith(CUSTOM_PREFIX)) return key.slice(CUSTOM_PREFIX.length)
  if (key.startsWith('pricing.')) return `${DIM_LABEL[lang].pricing} · ${SLOT_LABEL[lang][key.slice(8) as PricingSlot] ?? key.slice(8)}`
  return DIM_LABEL[lang][key as Dimension] ?? key
}

export const REASON: Record<Lang, Record<string, string>> = {
  zh: {
    not_found: '没有找到相关信息',
    quote_not_found: '引用的原文在来源页面里找不到',
    unreachable: '来源页面无法访问',
    unsupported: '证据不支持这个结论',
    conflict: '不同来源的说法不一致',
    seo_only: '只有搜索摘要，缺少官网来源',
    stale: '第三方来源没有更新日期，或已超过 12 个月',
  },
  en: {
    not_found: 'nothing relevant found',
    quote_not_found: 'quoted text not found on the source page',
    unreachable: 'source page unreachable',
    unsupported: 'evidence does not support the value',
    conflict: 'sources disagree',
    seo_only: 'search snippet only, no official source',
    stale: 'third-party source undated or over 12 months old',
  },
}

export const T = {
  zh: {
    start: (k: number) => `开始调研 ${k} 个对象：官网、相关网页、新闻、社媒`,
    stepSite: (n: string) => `${n} · 正在搜索官网…`,
    stepPages: (n: string, k: number) => `${n} · 读取官网页面（${k} 页）`,
    stepSeo: (n: string) => `${n} · 查看搜索排名`,
    stepNews: (n: string, k: number) => `${n} · 找到 ${k} 条相关新闻`,
    stepSocial: (n: string) => `${n} · 查看社媒账号和公开帖子`,
    stepFields: (n: string, k: number) => `${n} · 按 ${k} 个自定义字段搜索并读取相关网页`,
    extracting: (n: string, k: number) => `${n} · 提取 ${k} 个字段并核对原文`,
    summarising: (n: string) => `${n} · 总结最新动态和社媒内容`,
    siteFound: (n: string, d: string, via = '') => `${n} · 找到官网 ${d}${via ? `（${via}）` : ''}`,
    siteMissing: (n: string) => `${n} · 没有找到官网，只用搜索和新闻结果`,
    siteRejected: (n: string, d: string) => `${n} · ${d} 不是官网（导航/下载/资讯站），已跳过`,
    siteBlocked: (n: string, d: string) => `${n} · 官网 ${d} 拒绝直接读取，改用搜索引擎收录的官网页面`,
    siteSnippets: (n: string, k: number) => `${n} · 从搜索引擎读取官网定价页 ${k} 条`,
    thirdParty: (n: string, k: number) => `${n} · 官网没有可读的价格，另读 ${k} 篇标有日期的第三方定价页（结果会标注）`,
    fetched: (n: string, k: number, parts: string) => `${n} · ${parts}，共 ${k} 个来源`,
    parts: (site: number, seo: number, news: number, social: number, web = 0) => `官网 ${site} 页 / 网页 ${web} 篇 / 搜索 ${seo} 条 / 新闻 ${news} 条 / 社媒 ${social} 条`,
    checking: (k: number) => `逐条核对 ${k} 条信息的来源 URL 与原文出处`,
    checkedOk: (ok: number, bad: number) => (bad ? `${ok} 条找到原文出处，${bad} 条需要复查` : '来源均可访问，出处已记录'),
    retry: (n: string, label: string, reason: string) => `${n} · ${label}：${reason}`,
    requery: (what: string) => `↺ ${what}`,
    reFetch: (d: string) => `改为直接抓取 ${d} 的相关页面重新提取`,
    reSearch: '换关键词重新搜索',
    passedAfter: '重查后校验通过',
    stillFailed: '仍未通过，不写入结果',
    selfDone: (k: number) => `自检完成 · ${k} 条通过`,
    organised: (d: number, social: boolean) => `整理为 ${d} 个字段${social ? '，社媒内容已提炼要点' : ''}`,
    noNews: '该时间段内没有公开动态',
    socialPoint: (p: string, h: string, k: string) => `${p} ${h} · 要点：${k}`,
    socialSummary: (n: number, k: string) => `近期 ${n} 条 · 要点：${k}`,
    newsSummary: (n: number) => `近期 ${n} 条动态`,
    accounts: (list: string) => `官方账号：${list}`,
    failedCompetitor: (n: string) => `${n} · 抓取失败，已跳过`,
  },
  en: {
    start: (k: number) => `Researching ${k} subjects: websites, related pages, news, social`,
    stepSite: (n: string) => `${n} · looking for the official site…`,
    stepPages: (n: string, k: number) => `${n} · reading ${k} pages on the official site`,
    stepSeo: (n: string) => `${n} · checking search rankings`,
    stepNews: (n: string, k: number) => `${n} · found ${k} news items`,
    stepSocial: (n: string) => `${n} · checking social accounts and public posts`,
    stepFields: (n: string, k: number) => `${n} · searching and reading pages for ${k} custom fields`,
    extracting: (n: string, k: number) => `${n} · extracting ${k} fields and checking each quote`,
    summarising: (n: string) => `${n} · summarising news and social posts`,
    siteFound: (n: string, d: string, via = '') => `${n} · official site ${d}${via ? ` (${via})` : ''}`,
    siteMissing: (n: string) => `${n} · no official site found, using search and news only`,
    siteRejected: (n: string, d: string) => `${n} · ${d} is not the official site (directory, download or media site), skipped`,
    siteBlocked: (n: string, d: string) => `${n} · ${d} refused direct reading, using its pages as indexed by search`,
    siteSnippets: (n: string, k: number) => `${n} · read ${k} official pricing results from search`,
    thirdParty: (n: string, k: number) => `${n} · no readable price on the official site, reading ${k} dated third-party pricing pages (marked in results)`,
    fetched: (n: string, k: number, parts: string) => `${n} · ${parts} — ${k} sources`,
    parts: (site: number, seo: number, news: number, social: number, web = 0) => `site ${site} pages / web ${web} / search ${seo} / news ${news} / social ${social}`,
    checking: (k: number) => `Checking source URL and quoted origin for ${k} facts`,
    checkedOk: (ok: number, bad: number) => (bad ? `${ok} facts traced to their source, ${bad} need another look` : 'All sources reachable, origins recorded'),
    retry: (n: string, label: string, reason: string) => `${n} · ${label}: ${reason}`,
    requery: (what: string) => `↺ ${what}`,
    reFetch: (d: string) => `Re-fetching the relevant pages on ${d}`,
    reSearch: 'Searching again with different keywords',
    passedAfter: 'Passed after re-query',
    stillFailed: 'Still failing — left out of results',
    selfDone: (k: number) => `Self-check done · ${k} passed`,
    organised: (d: number, social: boolean) => `Organised into ${d} fields${social ? ', social posts summarised' : ''}`,
    noNews: 'No public updates in this period',
    socialPoint: (p: string, h: string, k: string) => `${p} ${h} · Key point: ${k}`,
    socialSummary: (n: number, k: string) => `${n} recent posts · Key point: ${k}`,
    newsSummary: (n: number) => `${n} recent updates`,
    accounts: (list: string) => `Official accounts: ${list}`,
    failedCompetitor: (n: string) => `${n} · fetch failed, skipped`,
  },
}

export const PLATFORM_LABEL: Record<string, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  reddit: 'Reddit',
  weibo: '微博',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  github: 'GitHub',
  bilibili: 'Bilibili',
  xiaohongshu: '小红书',
  zhihu: '知乎',
  wechat: '公众号',
}
