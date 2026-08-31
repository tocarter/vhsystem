import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { Permission } from '~/lib/permissions'
import { roleInputSchema } from '~/lib/validation'
import { createRole, deleteRole, listRoles, updateRole } from '../services/roles'
import { listAuditEvents } from '../services/audit'
import { permissionMiddleware } from './middleware'

export const fetchRoles = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('roles.manage')])
  .handler(async () => listRoles())

export const addRole = createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('roles.manage')])
  .validator((data: unknown) => roleInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const roleId = await createRole({
      actorId: context.viewer.id,
      key: data.key,
      name: data.name,
      description: data.description || undefined,
      permissions: data.permissions as Array<Permission>,
    })
    return { roleId }
  })

export const saveRole = createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('roles.manage')])
  .validator((data: unknown) =>
    roleInputSchema.omit({ key: true }).extend({ roleId: z.uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await updateRole({
      actorId: context.viewer.id,
      roleId: data.roleId,
      name: data.name,
      description: data.description || undefined,
      permissions: data.permissions as Array<Permission>,
    })
    return { ok: true as const }
  })

export const removeRole = createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('roles.manage')])
  .validator((data: unknown) => z.object({ roleId: z.uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await deleteRole({ actorId: context.viewer.id, roleId: data.roleId })
    return { ok: true as const }
  })

export const fetchAuditEvents = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('audit.view')])
  .validator((data: unknown) =>
    z.object({ limit: z.number().int().min(1).max(300).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }) => listAuditEvents(data.limit ?? 150))
