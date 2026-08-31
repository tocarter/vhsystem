import type { SessionUser } from './viewer'

/** Single source of truth for where a signed-in member belongs right now. */
export function homeFor(session: SessionUser | null): string {
  if (!session) return '/'
  if (session.status === 'suspended') return '/suspended'
  if (session.status === 'pending') {
    return session.hasSubmittedApplication ? '/pending' : '/register'
  }
  return '/dashboard'
}

/**
 * After Google sign-in: unmatched / incomplete members always go to
 * registration (or their status screen). Only approved members may follow
 * a deep-link `redirect`.
 */
export function destinationAfterLogin(
  session: SessionUser | null,
  requested?: string | null,
): string {
  const home = homeFor(session)
  if (!session || session.status !== 'approved') return home
  return safeRedirectPath(requested ?? undefined) ?? home
}

/**
 * Prevents an open redirect through the post-login `redirect` parameter.
 * Only same-origin absolute paths survive. Note that browsers read a leading
 * `/\` the same way they read `//`, so both forms have to go.
 */
export function safeRedirectPath(value: string | undefined): string | null {
  if (!value) return null
  if (value.length > 512) return null
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  if (value[0] !== '/') return null
  if (value[1] === '/' || value[1] === '\\') return null
  return value
}
