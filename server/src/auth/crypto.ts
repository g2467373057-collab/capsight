import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))))

const N = 16384
const R = 8
const P = 1
const LEN = 64

/** Format: scrypt$N$r$p$salt$hash (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password.normalize('NFKC'), salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$')
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64url')
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** A hash to compare against when the e-mail is unknown, so timing does not reveal accounts. */
let dummy: string | undefined
export async function dummyHash() {
  dummy ??= await hashPassword(randomBytes(12).toString('hex'))
  return dummy
}

export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`
