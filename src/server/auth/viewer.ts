import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { unauthenticated } from '~/lib/errors'
import type { Permission, Viewer } from '~/lib/permissions'
import type { SessionUser } from '~/lib/viewer'
import {
  findSessionUserId,
  readCookie,
  readSessionToken,
  sessionCookieName,
} from './session'

export type ServerViewer = SessionUser & { roleId: string }

export async function loadViewer(userId: string): Promise<ServerViewer | null> {
  const db = await getDb()

  const rows = await db
    .select({
      user: schema.users,
      role: schema.roles,
    })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
    .where(eq(schema.users.id, userId))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const permissionRows = await db
    .select({ permission: schema.rolePermissions.permission })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, row.role.id))

  const pendingApplications = await db
    .select({ id: schema.membershipApplications.id })
    .from(schema.membershipApplications)
    .where(
      and(
        eq(schema.membershipApplications.userId, userId),
        eq(schema.membershipApplications.status, 'pending'),
      ),
    )
    .limit(1)

  return {
    id: row.user.id,
    email: row.user.email,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
    discordHandle: row.user.discordHandle,
    phone: row.user.phone,
    avatarUrl: row.user.avatarUrl,
    status: row.user.status,
    role: { key: row.role.key, name: row.role.name },
    permissions: permissionRows.map((p) => p.permission) as Array<Permission>,
    hasSubmittedApplication: pendingApplications.length > 0,
    roleId: row.role.id,
  }
}

export async function getViewer(): Promise<ServerViewer | null> {
  const token = readSessionToken()
  if (!token) return null
  const userId = await findSessionUserId(token)
  if (!userId) return null
  return loadViewer(userId)
}

/** For server routes, which already hold the `Request`. */
export async function getViewerForRequest(
  request: Request,
): Promise<ServerViewer | null> {
  const token = readCookie(
    request.headers.get('cookie') ?? undefined,
    sessionCookieName(),
  )
  if (!token) return null
  const userId = await findSessionUserId(token)
  if (!userId) return null
  return loadViewer(userId)
}

export async function requireViewer(): Promise<ServerViewer> {
  const viewer = await getViewer()
  if (!viewer) throw unauthenticated()
  return viewer
}

export function toPermissionViewer(viewer: ServerViewer): Viewer {
  return {
    id: viewer.id,
    status: viewer.status,
    permissions: viewer.permissions,
  }
}