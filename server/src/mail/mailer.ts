import type { Config } from '../config.ts'

export interface Mail {
  to: string
  subject: string
  html: string
  text: string
}

export interface Mailer {
  send(m: Mail): Promise<void>
  /** Test hook: the last messages sent through the log mailer. */
  outbox?: Mail[]
}

/** Resend (https://resend.com) when a key is configured, otherwise the mail is written to the log. */
export function createMailer(c: Config): Mailer {
  if (c.keys.resend) {
    const key = c.keys.resend
    return {
      async send(m) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: c.mailFrom, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) throw new Error(`resend_${res.status}: ${(await res.text()).slice(0, 200)}`)
      },
    }
  }
  const outbox: Mail[] = []
  return {
    outbox,
    async send(m) {
      outbox.push(m)
      if (outbox.length > 50) outbox.shift()
      if (c.env !== 'test') console.log(`[mail → ${m.to}] ${m.subject}\n${m.text}\n`)
    },
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

export function linkMail(lang: 'zh' | 'en', kind: 'verify' | 'reset', name: string, link: string): Omit<Mail, 'to'> {
  const zh = lang === 'zh'
  const subject =
    kind === 'verify' ? (zh ? '验证你的胶囊AI 邮箱' : 'Verify your Capsight e-mail') : zh ? '重置胶囊AI 密码' : 'Reset your Capsight password'
  const line =
    kind === 'verify'
      ? zh
        ? '点击下面的链接完成邮箱验证，链接 24 小时内有效。'
        : 'Click the link below to verify your e-mail. It expires in 24 hours.'
      : zh
        ? '点击下面的链接设置新密码，链接 1 小时内有效。如果不是你本人操作，请忽略这封邮件。'
        : 'Click the link below to choose a new password. It expires in 1 hour. If this was not you, ignore this e-mail.'
  const hi = zh ? `你好，${name}：` : `Hi ${name},`
  return {
    subject,
    text: `${hi}\n\n${line}\n\n${link}\n\n胶囊AI · Capsight`,
    html: `<p>${esc(hi)}</p><p>${esc(line)}</p><p><a href="${esc(link)}">${esc(link)}</a></p><p style="color:#7a7474">胶囊AI · Capsight</p>`,
  }
}
