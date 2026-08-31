import crypto from 'node:crypto'
import { sessionSecret } from './env'

export function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.randomBytes(bytes))
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function pkceChallenge(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest())
}

function hmac(payload: string, secret: string): string {
  return base64url(crypto.createHmac('sha256', secret).update(payload).digest())
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export type SignedPayload = Record<string, string | number | boolean>

/**
 * Short-lived, tamper-evident tokens used for attachment downloads. They carry
 * their own expiry so a leaked URL stops working on its own, and every consumer
 * still re-checks authorization server-side.
 */
export function signPayload(payload: SignedPayload, ttlSeconds: number): string {
  const secret = sessionSecret()
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }
  const encoded = base64url(JSON.stringify(body))
  return `${encoded}.${hmac(encoded, secret)}`
}

export function verifyPayload<T extends SignedPayload>(
  token: string,
): (T & { exp: number }) | null {
  const secret = sessionSecret()
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null

  const encoded = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!timingSafeEqual(signature, hmac(encoded, secret))) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const payload = parsed as T & { exp?: unknown }
  if (typeof payload.exp !== 'number') return null
  if (payload.exp < Math.floor(Date.now() / 1000)) return null

  return payload as T & { exp: number }
}

const VERIFICATION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Human-transcribable id a school can type into the public verify page. */
export function generateVerificationId(): string {
  const bytes = crypto.randomBytes(10)
  let out = ''
  for (let i = 0; i < 10; i += 1) {
    out += VERIFICATION_ALPHABET[bytes[i]! % VERIFICATION_ALPHABET.length]
    if (i === 4) out += '-'
  }
  return `VH-${out}`
}
