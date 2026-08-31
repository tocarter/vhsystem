import type { Permission } from './permissions'

export type MemberStatus = 'pending' | 'approved' | 'suspended'

/** The client-safe projection of the signed-in member. */
export type SessionUser = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  discordHandle: string | null
  phone: string | null
  avatarUrl: string | null
  status: MemberStatus
  role: { key: string; name: string }
  permissions: Array<Permission>
  hasSubmittedApplication: boolean
}

export function displayName(
  user: Pick<SessionUser, 'firstName' | 'lastName' | 'email'>,
): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return full.length > 0 ? full : user.email
}

export function initials(
  user: Pick<SessionUser, 'firstName' | 'lastName' | 'email'>,
): string {
  const first = user.firstName?.[0]
  const last = user.lastName?.[0]
  if (first || last) return `${first ?? ''}${last ?? ''}`.toUpperCase()
  return user.email.slice(0, 2).toUpperCase()
}
