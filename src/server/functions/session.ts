import { createServerFn } from '@tanstack/react-start'
import type { SessionUser } from '~/lib/viewer'
import { getViewer } from '../auth/viewer'
import {
  clearSessionCookie,
  readSessionToken,
  revokeSession,
} from '../auth/session'

export const fetchSessionUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    const viewer = await getViewer()
    if (!viewer) return null

    const { roleId: _roleId, ...sessionUser } = viewer
    return sessionUser
  },
)

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  const token = readSessionToken()
  if (token) await revokeSession(token)
  clearSessionCookie()
  return { ok: true as const }
})
