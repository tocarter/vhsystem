import { createServerFn } from '@tanstack/react-start'
import { forbidden } from '~/lib/errors'
import {
  applicationDecisionSchema,
  applicationInputSchema,
} from '~/lib/validation'
import { z } from 'zod'
import {
  decideApplication,
  listMembers,
  setMemberStatus,
  submitApplication,
} from '../services/members'
import { assignRole, listRoles } from '../services/roles'
import { can } from '~/lib/permissions'
import { toPermissionViewer } from '../auth/viewer'
import { authedMiddleware, permissionMiddleware, rateLimitMiddleware } from './middleware'

export const submitRegistration = createServerFn({ method: 'POST' })
  .middleware([
    rateLimitMiddleware({ key: 'registration', max: 10, windowMs: 60 * 60_000 }),
    authedMiddleware,
  ])
  .validator((data: unknown) => applicationInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const applicationId = await submitApplication({
      userId: context.viewer.id,
      data,
    })
    return { applicationId }
  })

export const decideRegistration = createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('members.review')])
  .validator((data: unknown) => applicationDecisionSchema.parse(data))
  .handler(async ({ data, context }) => {
    await decideApplication({
      actorId: context.viewer.id,
      applicationId: data.applicationId,
      decision: data.decision,
      decisionNote: data.decisionNote || undefined,
    })
    return { ok: true as const }
  })

export const changeMemberStatus = createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('members.manage')])
  .validator((data: unknown) =>
    z
      .object({
        userId: z.uuid(),
        status: z.enum(['approved', 'suspended']),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    if (data.userId === context.viewer.id && data.status === 'suspended') {
      throw forbidden('You cannot suspend your own account.')
    }
    await setMemberStatus({
      actorId: context.viewer.id,
      userId: data.userId,
      status: data.status,
    })
    return { ok: true as const }
  })

export const changeMemberRole = createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('members.assign_role')])
  .validator((data: unknown) =>
    z.object({ userId: z.uuid(), roleId: z.uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    if (data.userId === context.viewer.id) {
      throw forbidden('Ask another administrator to change your own role.')
    }
    await assignRole({
      actorId: context.viewer.id,
      userId: data.userId,
      roleId: data.roleId,
    })
    return { ok: true as const }
  })

/**
 * One round trip for the people screen: the directory plus only the extras the
 * viewer is actually allowed to act on.
 */
export const fetchPeopleDirectory = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('members.view')])
  .validator((data: unknown) =>
    z
      .object({
        status: z.enum(['pending', 'approved', 'suspended']).optional(),
        search: z.string().max(120).optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const viewer = toPermissionViewer(context.viewer)
    const mayAssignRoles = can(viewer, 'members.assign_role')

    const [members, roles] = await Promise.all([
      listMembers(data),
      mayAssignRoles ? listRoles() : Promise.resolve([]),
    ])

    return {
      members,
      roles: roles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
      })),
      permissions: {
        mayAssignRoles,
        mayManage: can(viewer, 'members.manage'),
        mayAdjustHours: can(viewer, 'hours.adjust'),
        mayViewRecords: can(viewer, 'requests.view_all'),
      },
      currentUserId: context.viewer.id,
    }
  })
