import { API_BASE, api } from './http'

export interface User {
  id?: string
  name: string
  email: string
  /** false = the account must confirm its e-mail before running research (server mode). */
  emailVerified?: boolean
}

const KEY = 'capsight-user'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** Minimum password length; the API enforces the same rule. */
export const MIN_PASSWORD = 8

/* Demo mode keeps only the e-mail and name in this browser, never the password. */
export function loadUser(): User | null {
  if (API_BASE) return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as Partial<User>
    return u && typeof u.email === 'string' ? { email: u.email, name: u.name || u.email.split('@')[0] } : null
  } catch {
    return null
  }
}

function saveUser(u: User | null) {
  if (API_BASE) return
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: the session lasts until reload */
  }
}

/** The signed-in user from the session cookie (server mode). */
export async function fetchMe(): Promise<User | null> {
  if (!API_BASE) return loadUser()
  return (await api<{ user: User | null }>('/auth/me')).user
}

export async function signIn(email: string, password: string): Promise<User> {
  if (API_BASE) return (await api<{ user: User }>('/auth/login', { body: { email, password } })).user
  await sleep(600)
  const u = { email: email.trim(), name: email.trim().split('@')[0] }
  saveUser(u)
  return u
}

export async function signUp(name: string, email: string, password: string, lang: 'zh' | 'en'): Promise<User> {
  if (API_BASE) return (await api<{ user: User }>('/auth/register', { body: { name, email, password, lang } })).user
  await sleep(700)
  const u = { email: email.trim(), name: name.trim() }
  saveUser(u)
  return u
}

export async function signOut() {
  saveUser(null)
  if (API_BASE) await api('/auth/logout', { body: {} }).catch(() => {})
}

export async function verifyEmail(token: string): Promise<User> {
  return (await api<{ user: User }>('/auth/verify', { body: { token } })).user
}

export async function resendVerification(lang: 'zh' | 'en') {
  await api('/auth/verify/resend', { body: { lang } })
}

export async function requestReset(email: string, lang: 'zh' | 'en') {
  if (!API_BASE) return sleep(500)
  await api('/auth/forgot', { body: { email, lang } })
}

export async function resetPassword(token: string, password: string): Promise<User> {
  return (await api<{ user: User }>('/auth/reset', { body: { token, password } })).user
}

/* ---- per-user query history (local only) ---- */
const hKey = (email: string) => `capsight-history:${email}`

export function loadHistory(email: string): string[] {
  try {
    const raw = localStorage.getItem(hKey(email))
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

export function saveHistory(email: string, list: string[]) {
  try {
    localStorage.setItem(hKey(email), JSON.stringify(list.slice(0, 8)))
  } catch {
    /* ignore */
  }
}
