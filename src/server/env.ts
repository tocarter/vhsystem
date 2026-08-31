import { invalid } from '~/lib/errors'

/**
 * `vite preview` and `node .output/server` do not load `.env` on their own.
 * Vercel injects variables, so we skip the file there.
 */
if (!process.env.VERCEL) {
  try {
    process.loadEnvFile('.env')
  } catch {
    // Optional locally. Production hosts inject env another way.
  }
}

/**
 * Every read happens inside a request so secrets never land in a client bundle
 * and edge runtimes that inject env per request still see real values.
 */
export function readEnv(name: string): string | undefined {
  // Guards against a stray space after `=` in a hand-edited .env file.
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

export function requireEnv(name: string): string {
  const value = readEnv(name)
  if (!value) {
    throw invalid(
      `Missing required environment variable: ${name}. Add it to .env locally or to the Vercel project settings.`,
    )
  }
  return value
}

/**
 * Signs session cookies, OAuth drafts and attachment URLs. Required on Vercel.
 * Local `vite preview` / `vite dev` may omit it — we use a localhost-only
 * fallback so signup is not blocked by an empty .env.
 */
export function sessionSecret(): string {
  const explicit = readEnv('SESSION_SECRET')
  if (explicit) return explicit
  if (!readEnv('VERCEL')) return 'vhsystem-local-dev-only'
  throw invalid(
    'SESSION_SECRET is not set. Add a long random string in the Vercel project environment variables.',
  )
}

export function appOrigin(): string {
  const explicit = readEnv('APP_ORIGIN')
  if (explicit) return new URL(explicit).origin
  const vercel = readEnv('VERCEL_PROJECT_PRODUCTION_URL') ?? readEnv('VERCEL_URL')
  if (vercel) return `https://${vercel}`
  return 'http://localhost:3000'
}

export function isSecureOrigin(): boolean {
  return appOrigin().startsWith('https://')
}

export function organization() {
  return {
    name: readEnv('ORG_NAME') ?? 'Volunteer Team',
    contactEmail: readEnv('ORG_CONTACT_EMAIL') ?? readEnv('EMAIL_FROM') ?? '',
    contactName: readEnv('ORG_CONTACT_NAME') ?? '',
  }
}

/**
 * Emails listed here are approved with the admin role on first sign-in, which
 * is the only way to bootstrap the very first administrator.
 */
/** Google OAuth is optional locally until credentials are pasted into .env. */
export function googleAuthConfigured(): boolean {
  return Boolean(readEnv('GOOGLE_CLIENT_ID') && readEnv('GOOGLE_CLIENT_SECRET'))
}

export function bootstrapAdminEmails(): Array<string> {
  const raw = readEnv('BOOTSTRAP_ADMIN_EMAILS')
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}
