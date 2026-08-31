import crypto from 'node:crypto'
import { invalid } from '~/lib/errors'
import { appOrigin, requireEnv } from '../env'
import { base64url } from '../tokens'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export function redirectUri(): string {
  return `${appOrigin()}/api/auth/google/callback`
}

export function buildAuthorizationUrl(options: {
  state: string
  codeChallenge: string
}): string {
  const params = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    // Force account choice so shared machines cannot silently reuse a session.
    prompt: 'select_account',
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

export type GoogleClaims = {
  sub: string
  email: string
  emailVerified: boolean
  name?: string
  picture?: string
}

type Jwks = { keys: Array<JsonWebKey & { kid?: string; alg?: string }> }

let jwksCache: { fetchedAt: number; jwks: Jwks } | undefined

async function getJwks(forceRefresh = false): Promise<Jwks> {
  const fresh =
    jwksCache && Date.now() - jwksCache.fetchedAt < 60 * 60 * 1000 && !forceRefresh
  if (fresh && jwksCache) return jwksCache.jwks

  const response = await fetch(JWKS_URL)
  if (!response.ok) throw invalid('Could not reach Google to verify sign-in.')
  const jwks = (await response.json()) as Jwks
  jwksCache = { fetchedAt: Date.now(), jwks }
  return jwks
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

/**
 * The ID token arrives over TLS straight from Google's token endpoint, but the
 * signature is still verified so a misbehaving intermediary cannot mint one.
 */
export async function verifyIdToken(idToken: string): Promise<GoogleClaims> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw invalid('Malformed Google sign-in token.')
  const [headerSegment, payloadSegment, signatureSegment] = parts as [
    string,
    string,
    string,
  ]

  const header = decodeSegment(headerSegment) as { kid?: string; alg?: string }
  if (header.alg !== 'RS256') throw invalid('Unexpected Google token algorithm.')

  const verifyWith = async (refresh: boolean) => {
    const jwks = await getJwks(refresh)
    const jwk = jwks.keys.find((key) => key.kid === header.kid)
    if (!jwk) return false
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' })
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${headerSegment}.${payloadSegment}`),
      publicKey,
      Buffer.from(signatureSegment, 'base64url'),
    )
  }

  // Google rotates signing keys; a miss just means the cache is stale.
  const verified = (await verifyWith(false)) || (await verifyWith(true))
  if (!verified) throw invalid('Google sign-in token failed verification.')

  const payload = decodeSegment(payloadSegment) as Record<string, unknown>

  if (typeof payload.iss !== 'string' || !ISSUERS.includes(payload.iss)) {
    throw invalid('Google sign-in token has the wrong issuer.')
  }
  const clientId = requireEnv('GOOGLE_CLIENT_ID')
  if (payload.aud !== clientId) {
    throw invalid('Google sign-in token was issued for another application.')
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    throw invalid('Google sign-in token has expired.')
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw invalid('Google sign-in token is missing an account id.')
  }
  if (typeof payload.email !== 'string') {
    throw invalid('Google did not share an email address.')
  }
  if (payload.email_verified !== true) {
    throw invalid('Verify your Google email address before signing in.')
  }

  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  }
}

export async function exchangeCodeForClaims(options: {
  code: string
  codeVerifier: string
}): Promise<GoogleClaims> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: options.code,
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: options.codeVerifier,
    }),
  })

  if (!response.ok) {
    throw invalid('Google rejected the sign-in attempt. Please try again.')
  }

  const payload = (await response.json()) as { id_token?: string }
  if (!payload.id_token) throw invalid('Google did not return an identity token.')
  return verifyIdToken(payload.id_token)
}

export function newPkcePair() {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(
    crypto.createHash('sha256').update(verifier).digest(),
  )
  return { verifier, challenge }
}
