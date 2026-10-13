import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** True for loopback, private, link-local, CGNAT, multicast, reserved and unique-local addresses. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7))
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff')
}

/** Rejects URLs that could reach internal services (SSRF). */
export async function assertPublicUrl(raw: string, allowPrivate = false): Promise<URL> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('bad_url')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad_scheme')
  if (u.username || u.password) throw new Error('credentials_in_url')
  if (allowPrivate) return u
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('bad_port')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('private_host')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private_host')
  return u
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Registrable-ish domain: last two labels, or three for common second-level suffixes (co.uk, com.cn …). */
export function baseDomain(host: string): string {
  const parts = host.replace(/^www\./, '').split('.')
  if (parts.length <= 2) return parts.join('.')
  const sld = parts.slice(-2).join('.')
  return /^(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/.test(sld) ? parts.slice(-3).join('.') : sld
}
