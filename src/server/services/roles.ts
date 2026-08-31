import { and, count, eq, inArray, ne } from 'drizzle-orm'
import { conflict, forbidden, notFound } from '~/lib/errors'
import {
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  type Permission,
} from '~/lib/permissions'
import { getDb, schema, type Executor } from '../db'
import { revokeAllSessionsForUser } from '../auth/session'
import { recordAudit } from './audit'

/** The capability that defines an administrator for last-admin protection. */
const ADMIN_DEFINING_PERMISSION: Permission = 'roles.manage'

export async function ensureSystemRoles(executor: Executor): Promise<void> {
  for (const key of Object.values(SYSTEM_ROLE_KEYS)) {
    const existing = await executor
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, key))
      .limit(1)

    if (existing.length > 0) continue

    const inserted = await executor
      .insert(schema.roles)
      .values({
        key,
        name: key === SYSTEM_ROLE_KEYS.admin ? 'Administrator' : 'Member',
        description:
          key === SYSTEM_ROLE_KEYS.admin
            ? 'Full access to members, requests, hours and roles.'
            : 'Can submit volunteer hour requests and view their own record.',
        isSystem: true,
      })
      .returning({ id: schema.roles.id })

    const roleId = inserted[0]!.id
    const permissions = DEFAULT_ROLE_PERMISSIONS[key] ?? []
    if (permissions.length > 0) {
      await executor
        .insert(schema.rolePermissions)
        .values(permissions.map((permission) => ({ roleId, permission })))
    }
  }
}

export async function getRoleByKey(executor: Executor, key: string) {
  const rows = await executor
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.key, key))
    .limit(1)
  return rows[0] ?? null
}

export async function requireRoleByKey(executor: Executor, key: string) {
  const role = await getRoleByKey(executor, key)
  if (!role) throw notFound(`Role "${key}" is not configured.`)
  return role
}

export type RoleSummary = {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  permissions: Array<Permission>
  memberCount: number
}

export async function listRoles(): Promise<Array<RoleSummary>> {
  const db = await getDb()
  const roles = await db.select().from(schema.roles).orderBy(schema.roles.name)
  const permissions = await db.select().from(schema.rolePermissions)
  const counts = await db
    .select({ roleId: schema.users.roleId, total: count() })
    .from(schema.users)
    .groupBy(schema.users.roleId)

  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: permissions
      .filter((p) => p.roleId === role.id)
      .map((p) => p.permission as Permission),
    memberCount: counts.find((c) => c.roleId === role.id)?.total ?? 0,
  }))
}

/** Approved members whose role still grants the administrator capability. */
async function countAdmins(
  executor: Executor,
  options: { excludeUserId?: string } = {},
): Promise<number> {
  const adminRoleIds = await executor
    .select({ roleId: schema.rolePermissions.roleId })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.permission, ADMIN_DEFINING_PERMISSION))

  if (adminRoleIds.length === 0) return 0

  const conditions = [
    inArray(
      schema.users.roleId,
      adminRoleIds.map((r) => r.roleId),
    ),
    eq(schema.users.status, 'approved'),
  ]
  if (options.excludeUserId) {
    conditions.push(ne(schema.users.id, options.excludeUserId))
  }

  const rows = await executor
    .select({ total: count() })
    .from(schema.users)
    .where(and(...conditions))

  return rows[0]?.total ?? 0
}

export async function assertAdminRemains(
  executor: Executor,
  options: { excludeUserId?: string } = {},
): Promise<void> {
  const remaining = await countAdmins(executor, options)
  if (remaining < 1) {
    throw conflict(
      'This would leave the team without an administrator. Promote someone else first.',
    )
  }
}

export async function createRole(input: {
  actorId: string
  key: string
  name: string
  description?: string
  permissions: Array<Permission>
}): Promise<string> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const existing = await getRoleByKey(tx, input.key)
    if (existing) throw conflict(`A role with the key "${input.key}" already exists.`)

    const inserted = await tx
      .insert(schema.roles)
      .values({
        key: input.key,
        name: input.name,
        description: input.description || null,
        isSystem: false,
      })
      .returning({ id: schema.roles.id })

    const roleId = inserted[0]!.id
    if (input.permissions.length > 0) {
      await tx
        .insert(schema.rolePermissions)
        .values(input.permissions.map((permission) => ({ roleId, permission })))
    }

    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.created',
      entityType: 'role',
      entityId: roleId,
      metadata: { key: input.key, permissions: input.permissions },
    })

    return roleId
  })
}

export async function updateRole(input: {
  actorId: string
  roleId: string
  name: string
  description?: string
  permissions: Array<Permission>
}): Promise<void> {
  const db = await getDb()
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.id, input.roleId))
      .limit(1)
    const role = rows[0]
    if (!role) throw notFound('That role no longer exists.')

    const previous = await tx
      .select({ permission: schema.rolePermissions.permission })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, role.id))

    await tx
      .update(schema.roles)
      .set({
        // System role identity is fixed so guards can rely on the key.
        name: role.isSystem ? role.name : input.name,
        description: input.description || null,
      })
      .where(eq(schema.roles.id, role.id))

    await tx
      .delete(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, role.id))

    if (input.permissions.length > 0) {
      await tx.insert(schema.rolePermissions).values(
        input.permissions.map((permission) => ({
          roleId: role.id,
          permission,
        })),
      )
    }

    await assertAdminRemains(tx)

    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.updated',
      entityType: 'role',
      entityId: role.id,
      metadata: {
        key: role.key,
        before: previous.map((p) => p.permission),
        after: input.permissions,
      },
    })
  })

  await revokeSessionsForRole(input.roleId)
}

export async function deleteRole(input: {
  actorId: string
  roleId: string
  fallbackRoleKey?: string
}): Promise<void> {
  const db = await getDb()
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.id, input.roleId))
      .limit(1)
    const role = rows[0]
    if (!role) throw notFound('That role no longer exists.')
    if (role.isSystem) throw forbidden('Built-in roles cannot be deleted.')

    const fallback = await requireRoleByKey(
      tx,
      input.fallbackRoleKey ?? SYSTEM_ROLE_KEYS.member,
    )

    await tx
      .update(schema.users)
      .set({ roleId: fallback.id, updatedAt: new Date() })
      .where(eq(schema.users.roleId, role.id))

    await tx
      .delete(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, role.id))
    await tx.delete(schema.roles).where(eq(schema.roles.id, role.id))

    await assertAdminRemains(tx)

    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.deleted',
      entityType: 'role',
      entityId: role.id,
      metadata: { key: role.key, reassignedTo: fallback.key },
    })
  })
}

export async function assignRole(input: {
  actorId: string
  userId: string
  roleId: string
}): Promise<void> {
  const db = await getDb()
  await db.transaction(async (tx) => {
    const userRows = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1)
    const user = userRows[0]
    if (!user) throw notFound('That member no longer exists.')

    const roleRows = await tx
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.id, input.roleId))
      .limit(1)
    const role = roleRows[0]
    if (!role) throw notFound('That role no longer exists.')
    if (user.roleId === role.id) return

    await tx
      .update(schema.users)
      .set({ roleId: role.id, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id))

    await assertAdminRemains(tx)

    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'member.role_changed',
      entityType: 'user',
      entityId: user.id,
      metadata: { to: role.key },
    })
  })

  // Privileges changed, so any session created under the old role is retired.
  await revokeAllSessionsForUser(input.userId)
}

async function revokeSessionsForRole(roleId: string): Promise<void> {
  const db = await getDb()
  const affected = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.roleId, roleId))

  for (const user of affected) {
    await revokeAllSessionsForUser(user.id)
  }
}