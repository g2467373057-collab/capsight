import { columnsOf, type Lang, type RunResult } from '../types.ts'
import { colLabel } from './i18n.ts'

const esc = (v: string) => (/[",\n\r]/.test(v) || /^[=+\-@\t]/.test(v) ? `"${v.replace(/^([=+\-@\t])/, "'$1").replace(/"/g, '""')}"` : v)

/** Same columns as the web app's export: each field followed by its sources, then the check result. UTF-8 with BOM for Excel. */
export function toCsv(result: RunResult, lang: Lang): string {
  const dims = columnsOf(result.intent)
  const L = (k: string) => colLabel(lang, k)
  const src = lang === 'zh' ? '来源' : 'source'
  const check = lang === 'zh' ? '校验' : 'check'
  const status = lang === 'zh' ? { verified: '通过', requeried: '重查后通过', missing: '未通过' } : { verified: 'passed', requeried: 'passed after re-query', missing: 'failed' }
  const lines = [[...dims.flatMap((d) => [L(d), `${L(d)}_${src}`]), check].map(esc).join(',')]
  for (const r of result.rows) {
    const out: string[] = []
    let worst: keyof typeof status = 'verified'
    for (const d of dims) {
      const c = r.cells[d]
      if (c && c.status !== 'missing' && c.gaps !== undefined) {
        // pricing template: plans first, then one line per slot, then the slots with no public information
        const none = lang === 'zh' ? '暂无公开信息' : 'No public information'
        out.push(
          [c.value, ...(c.items ?? []).map((i) => `${i.label}${lang === 'zh' ? '：' : ': '}${i.text}`), ...(c.gaps.length ? [`${none}${lang === 'zh' ? '：' : ': '}${c.gaps.join(' / ')}`] : [])].join('\n'),
          [...new Set([...c.sources.map((s) => s.url), ...(c.items ?? []).map((i) => i.url)])].join(' | '),
        )
      } else if (c && c.status !== 'missing' && c.items?.length) {
        out.push(
          c.items.map((i) => [i.date, i.label && `[${i.label}]`, i.text].filter(Boolean).join(' ')).join('\n'),
          [...c.items.map((i) => i.url), ...c.sources.filter((s) => !c.items!.some((i) => i.url === s.url)).map((s) => s.url)].join(' | '),
        )
      } else if (c && c.status !== 'missing') out.push(c.date ? `${c.date} ${c.value}` : c.value, c.sources.map((s) => s.url).join(' | '))
      else out.push('', '')
      if (c?.status === 'missing') worst = 'missing'
      else if (c?.status === 'requeried' && worst === 'verified') worst = 'requeried'
    }
    out.push(status[worst])
    lines.push(out.map(esc).join(','))
  }
  return '﻿' + lines.join('\r\n')
}
