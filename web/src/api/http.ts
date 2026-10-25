/**
 * Base URL of the Capsight API.
 * Default "/api": the same server that serves the page (share.sh, Docker, Render), or the Vite dev proxy.
 * Set VITE_API_BASE=demo to build the offline demo with built-in sample data.
 */
const RAW_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').trim()
export const API_BASE = RAW_BASE.toLowerCase() === 'demo' ? undefined : RAW_BASE.replace(/\/$/, '') || '/api'
export const isDemo = !API_BASE

/** An error from the API, carrying its machine-readable code (e.g. "daily_limit"). */
export class ApiError extends Error {
  code: string
  status: number
  extra: Record<string, unknown>
  constructor(code: string, status: number, extra: Record<string, unknown> = {}) {
    super(code)
    this.code = code
    this.status = status
    this.extra = extra
  }
}

export async function api<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError('network', 0)
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const { error, ...extra } = data
    throw new ApiError(String(error ?? `http_${res.status}`), res.status, extra)
  }
  return data as T
}
