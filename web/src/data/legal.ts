import type { Lang } from '../api/types'
import { OPERATOR as O } from './site'

export type LegalPage = 'privacy' | 'terms' | 'bot'

export interface LegalDoc {
  title: string
  intro: string
  sections: { h: string; p: string[]; code?: string }[]
}

/** Drafts written for this product. Have them reviewed for your entity and jurisdiction before launch. */
export const LEGAL: Record<Lang, Record<LegalPage, LegalDoc>> = {
  zh: {
    privacy: {
      title: '隐私政策',
      intro: `${O.name}（“我们”）运营胶囊AI（Capsight）。本政策说明我们收集哪些信息、怎么用、交给谁处理，以及你可以怎么管理。`,
      sections: [
        { h: '我们收集的信息', p: ['账号信息：邮箱、昵称，以及加密（scrypt 哈希）后的密码，我们无法看到你的明文密码。', '使用信息：你输入的调研问题、确认后的查询条件和调研结果。', '安全信息：登录会话（保存在安全 Cookie 中）、IP 地址和浏览器类型，用于防止滥用和账号被盗用。'] },
        { h: '我们不做的事', p: ['不出售你的数据，不做广告追踪，不在第三方网站跟踪你。'] },
        { h: '信息的用途', p: ['提供调研服务并保存你的查询历史；发送邮箱验证和找回密码邮件；统计每日免费额度；发现和阻止异常使用。'] },
        { h: '第三方处理方', p: ['为完成调研，你的问题和抓取到的公开网页内容会发送给大模型服务（例如 DeepSeek、Anthropic）和搜索服务（例如 Serper、博查）处理。', '社媒内容通过各平台官方接口（X、YouTube、Reddit）读取，或来自搜索引擎已收录的公开页面（例如 LinkedIn、微博、小红书、公众号），并由 AI 生成摘要、附原文链接。邮件通过 Resend 发送。这些服务商只为提供服务处理数据。'] },
        { h: '存储地点与期限', p: [`数据存放在位于${O.region.zh}的服务器，部分第三方服务商可能在其他国家或地区处理数据。`, '账号存续期间保存账号和查询记录；抓取到的公开网页和搜索结果缓存最多 12 小时。注销账号后 30 天内删除相关数据。'] },
        { h: '你的权利', p: [`你可以查询、更正、导出或删除你的数据，也可以注销账号。请发邮件到 ${O.email}，我们会在 15 个工作日内处理。`] },
        { h: '未成年人', p: ['本服务面向工作场景，不面向未成年人。'] },
        { h: '政策更新', p: [`最近更新：${O.updated}。重大变更会在网站上提示。`] },
      ],
    },
    terms: {
      title: '服务条款',
      intro: `欢迎使用胶囊AI（Capsight）。注册或使用本服务，即表示你同意以下条款。本服务由 ${O.name} 提供。`,
      sections: [
        { h: '服务内容', p: ['胶囊AI 根据公开网络信息，帮你整理竞品的地区、功能、定价、联系方式、社媒账号和最新动态，并为每条信息附上来源。', '结果由 AI 自动生成，虽然经过来源校验和自检，仍可能出错或过时。请点开来源核对；结果不构成商业、法律或投资建议。'] },
        { h: '免费与额度', p: ['目前全流程免费。为保证服务稳定，每个账号每天的调研次数有上限，我们可能根据运营情况调整。'] },
        { h: '使用规范', p: ['不得用本服务收集个人隐私信息、攻击或干扰任何网站、绕过登录或付费限制，或用于任何违法用途。', '不得用脚本批量、自动化地调用本服务。违反规范的账号可能被限制或停用。'] },
        { h: '内容与版权', p: ['结果中引用的网页内容版权归原网站所有。我们只展示核对所需的简短摘录，并标注来源链接。'] },
        { h: '账号', p: ['请妥善保管密码。发现账号异常请及时联系我们。'] },
        { h: '责任限制', p: ['在法律允许的范围内，我们不对因使用或无法使用本服务造成的间接损失负责。服务可能因维护或第三方服务中断而暂停。'] },
        { h: '知识产权', p: [`胶囊AI、Capsight 的名称、标识、页面设计、文案和软件代码的著作权及其他知识产权归 ${O.name} 所有。未经书面许可，不得复制、修改、传播或用于商业用途。`, '你用本服务生成并导出的调研结果，可以自由用于你自己的工作。'] },
        { h: '条款变更与适用法律', p: ['条款更新会在网站公布，继续使用即视为接受。本条款适用新加坡法律；对中国大陆用户，同时适用中华人民共和国法律中必须适用的规定（例如个人信息保护的相关规定）。', `商务合作与咨询：${O.email}。最近更新：${O.updated}。`] },
      ],
    },
    bot: {
      title: '关于 CapsightBot 爬虫',
      intro: 'CapsightBot 是胶囊AI 的网页抓取程序。只有当用户发起调研时，它才会按需访问相关企业官网的少量公开页面。',
      sections: [
        { h: '它会访问什么', p: ['企业官网的首页、定价、关于我们、联系我们、产品功能等公开页面，每次调研每个网站通常不超过 10 个页面。', '它不会登录、不会提交表单、不会绕过付费墙或访问限制。'] },
        { h: '遵守 robots.txt', p: ['CapsightBot 会先读取 robots.txt 并遵守其中的规则。如果不希望被访问，可以加入：'], code: 'User-agent: CapsightBot\nDisallow: /' },
        { h: '访问频率', p: ['每个请求都有超时和大小限制；抓到的页面会缓存最多 12 小时，避免重复访问。'] },
        { h: '联系我们', p: [`如果你认为 CapsightBot 影响了你的网站，请联系 ${O.email}。`] },
      ],
    },
  },
  en: {
    privacy: {
      title: 'Privacy Policy',
      intro: `${O.name} (“we”) operates Capsight. This policy explains what we collect, how we use it, who processes it, and how you can control it.`,
      sections: [
        { h: 'What we collect', p: ['Account data: e-mail, name and a scrypt hash of your password — we never see the password itself.', 'Usage data: the questions you ask, the confirmed query and the research results.', 'Security data: your login session (in a secure cookie), IP address and browser type, used to prevent abuse and account takeover.'] },
        { h: 'What we do not do', p: ['We do not sell your data, run ad tracking, or track you on other websites.'] },
        { h: 'How we use it', p: ['To run research and keep your history; to send verification and password-reset e-mails; to count daily free runs; to detect and stop abuse.'] },
        { h: 'Processors', p: ['To complete a run, your question and the public web content we fetch are sent to an AI model provider (e.g. DeepSeek, Anthropic) and a search provider (e.g. Serper, Bocha).', 'Social posts are read through official APIs (X, YouTube, Reddit) or from public pages indexed by search engines (e.g. LinkedIn, Weibo, Xiaohongshu, WeChat), then summarised by AI with a link to the original. E-mail is sent through Resend. These providers process data only to deliver the service.'] },
        { h: 'Where and how long', p: [`Data is stored on servers in ${O.region.en}; some providers may process it in other countries.`, 'Account and history are kept while your account exists; fetched public pages and search results are cached for up to 12 hours. We delete your data within 30 days of account deletion.'] },
        { h: 'Your rights', p: [`You can access, correct, export or delete your data, or close your account. E-mail ${O.email}; we respond within 15 business days.`] },
        { h: 'Children', p: ['The service is meant for work use and is not directed at children.'] },
        { h: 'Changes', p: [`Last updated: ${O.updated}. Material changes will be announced on the site.`] },
      ],
    },
    terms: {
      title: 'Terms of Service',
      intro: `Welcome to Capsight, provided by ${O.name}. By signing up or using the service you agree to these terms.`,
      sections: [
        { h: 'The service', p: ['Capsight organises public information about competitors — region, features, pricing, contact, social accounts and latest news — and attaches a source to every fact.', 'Results are generated by AI. They are source-checked and self-checked but can still be wrong or outdated. Open the sources to confirm. Results are not business, legal or investment advice.'] },
        { h: 'Free use and limits', p: ['The service is currently free end to end. Each account has a daily run limit, which we may adjust.'] },
        { h: 'Acceptable use', p: ['Do not use the service to collect personal data, attack or disrupt any website, get around logins or paywalls, or for anything unlawful.', 'Do not call the service in bulk with scripts. Accounts that break these rules may be limited or closed.'] },
        { h: 'Content and copyright', p: ['Quoted web content belongs to its owners. We show only short excerpts needed for checking, always with a link to the source.'] },
        { h: 'Your account', p: ['Keep your password safe and tell us about any suspicious activity.'] },
        { h: 'Liability', p: ['To the extent permitted by law, we are not liable for indirect losses from using or being unable to use the service. The service may pause for maintenance or third-party outages.'] },
        { h: 'Intellectual property', p: [`The Capsight name, logo, page design, copy and software are owned by ${O.name}, including copyright. Do not copy, modify, distribute or use them commercially without written permission.`, 'Research results you generate and export are yours to use in your own work.'] },
        { h: 'Changes and governing law', p: ['We publish updates on the site; continued use means you accept them. These terms are governed by the laws of Singapore. For users in mainland China, mandatory provisions of PRC law (such as personal information protection rules) also apply.', `Business and enquiries: ${O.email}. Last updated: ${O.updated}.`] },
      ],
    },
    bot: {
      title: 'About the CapsightBot crawler',
      intro: 'CapsightBot is Capsight’s web fetcher. It visits a handful of public pages on a company’s website only when a user runs research about that company.',
      sections: [
        { h: 'What it visits', p: ['Public pages such as the homepage, pricing, about, contact and product pages — usually no more than 10 pages per site per run.', 'It never logs in, submits forms, or gets around paywalls or access controls.'] },
        { h: 'It follows robots.txt', p: ['CapsightBot reads and obeys robots.txt. To opt out, add:'], code: 'User-agent: CapsightBot\nDisallow: /' },
        { h: 'Load', p: ['Every request has a timeout and size limit, and fetched pages are cached for up to 12 hours to avoid repeat visits.'] },
        { h: 'Contact', p: [`If CapsightBot causes a problem for your site, contact ${O.email}.`] },
      ],
    },
  },
}
