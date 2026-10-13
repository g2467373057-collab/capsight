/** Social profiles shown in the navbar and footer. Replace the URLs with your own accounts. */
export const SOCIAL_LINKS = [
  { key: 'x', label: 'X', url: 'https://x.com/' },
  { key: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/' },
  { key: 'reddit', label: 'Reddit', url: 'https://www.reddit.com/' },
] as const

/**
 * Who runs the service — used on the privacy, terms and crawler pages.
 * While these still contain "[", those pages show a "draft" notice.
 */
export const OPERATOR = {
  name: 'yisa',
  email: 'g2467373057@gmail.com',
  region: { zh: '新加坡', en: 'Singapore' },
  updated: '2026-10-10',
}

export const isLegalDraft = [OPERATOR.name, OPERATOR.email, OPERATOR.region.zh].some((v) => v.includes('['))
