import type { Config } from '../config.ts'
import { clearAttempts, countAttempts, recordAttempt, type Db } from '../db/db.ts'
import { HttpError, setCookie, type Ctx } from '../http/http.ts'
import { linkMail, type Mailer } from '../mail/mailer.ts'
import type { Lang, PublicUser } from '../types.ts'
import { dummyHash, hashPassword, newId, newToken, sha256, verifyPassword } from './crypto.ts'

interface UserRow {
  id: string
  email: string
  name: string
  password_hash: string
  email_verified: number
  created_at: number
}

const DAY = 24 * 3600_000
export const isEmail = (v: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)
const toPublic = (u: UserRow): PublicUser => ({ id: u.id, name: u.name, email: u.email, emailVerified: !!u.email_verified })

export class Auth {
  private db: Db
  private cfg: Config
  private mailer: Mailer
  constructor(db: Db, cfg: Config, mailer: Mailer) {
    this.db = db
    this.cfg = cfg
    this.mailer = mailer
  }

  private userByEmail(email: string) {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
  }
  private userById(id: string) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  }

  /* ---------- sessions ---------- */

  private startSession(ctx: Ctx, userId: string) {
    const token = newToken()
    const now = Date.now()
    const ttl = this.cfg.cookie.days * DAY
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(token), userId, now, now + ttl, ctx.ip, String(ctx.req.headers['user-agent'] ?? '').slice(0, 200))
    setCookie(ctx.res, this.cfg.cookie.name, token, {
      maxAgeSec: ttl / 1000,
      secure: this.cfg.cookie.secure,
      sameSite: this.cfg.cookie.sameSite,
      domain: this.cfg.cookie.domain,
    })
  }

  private clearCookie(ctx: Ctx) {
    setCookie(ctx.res, this.cfg.cookie.name, '', {
      maxAgeSec: 0,
      secure: this.cfg.cookie.secure,
      sameSite: this.cfg.cookie.sameSite,
      domain: this.cfg.cookie.domain,
    })
  }

  /** Resolve the signed-in user from the session cookie (or null). */
  current(ctx: Ctx): PublicUser | null {
    if (ctx.state.user !== undefined) return ctx.state.user as PublicUser | null
    const token = ctx.cookies[this.cfg.cookie.name]
    let user: PublicUser | null = null
    if (token) {
      const row = this.db
        .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
        .get(sha256(token), Date.now()) as UserRow | undefined
      user = row ? toPublic(row) : null
    }
    ctx.state.user = user
    return user
  }

  require(ctx: Ctx, opts: { verified?: boolean } = {}): PublicUser {
    const u = this.current(ctx)
    if (!u) throw new HttpError(401, 'auth_required')
    if (opts.verified && this.cfg.requireEmailVerification && !u.emailVerified) throw new HttpError(403, 'email_unverified')
    return u
  }

  /* ---------- flows ---------- */

  private throttle(key: string, max: number, windowMs: number) {
    if (countAttempts(this.db, key, windowMs) >= max) throw new HttpError(429, 'too_many_attempts')
    recordAttempt(this.db, key)
  }

  async register(ctx: Ctx, input: { name?: unknown; email?: unknown; password?: unknown; lang?: unknown }) {
    const name = String(input.name ?? '').trim().slice(0, 40)
    const email = String(input.email ?? '').trim().toLowerCase()
    const password = String(input.password ?? '')
    const lang: Lang = input.lang === 'en' ? 'en' : 'zh'
    if (!name) throw new HttpError(400, 'name_required')
    if (!isEmail(email)) throw new HttpError(400, 'invalid_email')
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'weak_password')
    this.throttle(`register:${ctx.ip}`, 10, 3600_000)
    if (this.userByEmail(email)) throw new HttpError(409, 'email_taken')
    const id = newId('usr')
    this.db
      .prepare('INSERT INTO users (id, email, name, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, email, name, await hashPassword(password), this.cfg.requireEmailVerification ? 0 : 1, Date.now())
    this.startSession(ctx, id)
    if (this.cfg.requireEmailVerification) await this.sendLink(id, 'verify', lang)
    return toPublic(this.userById(id)!)
  }

  async login(ctx: Ctx, input: { email?: unknown; password?: unknown }) {
    const email = String(input.email ?? '').trim().toLowerCase()
    const password = String(input.password ?? '')
    const key = `login:${email}`
    this.throttle(`login-ip:${ctx.ip}`, 30, 15 * 60_000)
    if (countAttempts(this.db, key, 15 * 60_000) >= 8) throw new HttpError(429, 'too_many_attempts')
    const u = this.userByEmail(email)
    const ok = await verifyPassword(password, u?.password_hash ?? (await dummyHash()))
    if (!u || !ok) {
      recordAttempt(this.db, key)
      throw new HttpError(401, 'invalid_credentials')
    }
    clearAttempts(this.db, key)
    this.startSession(ctx, u.id)
    return toPublic(u)
  }

  logout(ctx: Ctx) {
    const token = ctx.cookies[this.cfg.cookie.name]
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
    this.clearCookie(ctx)
  }

  private async sendLink(userId: string, kind: 'verify' | 'reset', lang: Lang) {
    const u = this.userById(userId)
    if (!u) return
    const token = newToken()
    const ttl = kind === 'verify' ? DAY : 3600_000
    this.db.prepare('UPDATE tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL').run(Date.now(), userId, kind)
    this.db.prepare('INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, kind, Date.now() + ttl)
    const link = `${this.cfg.appUrl}/#${kind}-${token}`
    await this.mailer.send({ to: u.email, ...linkMail(lang, kind, u.name, link) })
  }

  async resendVerification(ctx: Ctx, lang: Lang) {
    const u = this.require(ctx)
    if (u.emailVerified) return
    this.throttle(`verify-mail:${u.id}`, 5, 3600_000)
    await this.sendLink(u.id, 'verify', lang)
  }

  private useToken(token: string, kind: 'verify' | 'reset'): string {
    const row = this.db
      .prepare('SELECT user_id, expires_at, used_at FROM tokens WHERE token_hash = ? AND kind = ?')
      .get(sha256(token), kind) as { user_id: string; expires_at: number; used_at: number | null } | undefined
    if (!row || row.used_at || row.expires_at < Date.now()) throw new HttpError(400, 'invalid_token')
    this.db.prepare('UPDATE tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), sha256(token))
    return row.user_id
  }

  verifyEmail(input: { token?: unknown }) {
    const userId = this.useToken(String(input.token ?? ''), 'verify')
    this.db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId)
    return toPublic(this.userById(userId)!)
  }

  /** Always succeeds from the caller's point of view, so it cannot be used to probe for accounts. */
  async forgot(ctx: Ctx, input: { email?: unknown; lang?: unknown }) {
    const email = String(input.email ?? '').trim().toLowerCase()
    this.throttle(`forgot-ip:${ctx.ip}`, 10, 3600_000)
    const u = isEmail(email) ? this.userByEmail(email) : undefined
    if (u && countAttempts(this.db, `forgot:${u.id}`, 3600_000) < 3) {
      recordAttempt(this.db, `forgot:${u.id}`)
      await this.sendLink(u.id, 'reset', input.lang === 'en' ? 'en' : 'zh')
    }
  }

  async reset(ctx: Ctx, input: { token?: unknown; password?: unknown }) {
    const password = String(input.password ?? '')
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'weak_password')
    const userId = this.useToken(String(input.token ?? ''), 'reset')
    this.db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(await hashPassword(password), userId)
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    this.startSession(ctx, userId)
    return toPublic(this.userById(userId)!)
  }
}
