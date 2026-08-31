import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { forbidden } from '~/lib/errors'
import { can } from '~/lib/permissions'
import { adjustmentSchema } from '~/lib/validation'
import { toPermissionViewer } from '../auth/viewer'
import { getDb } from '../db'
import {
  createAdjustment,
  issueSummaryCertificate,
  listLedgerForUser,
  totalMinutesForUser,
} from '../services/hours'
import { approvedMiddleware, permissionMiddleware } from './middleware'

export const postAdjustment = createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('hours.adjust')])
  .validator((data: unknown) => adjustmentSchema.parse(data))
  .handler(async ({ data, context }) => {
    await createAdjustment({
      actorId: context.viewer.id,
      userId: data.userId,
      hours: data.hours,
      reason: data.reason,
    })
    return { ok: true as const }
  })

export const fetchMemberRecord = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('requests.view_all')])
  .validator((data: unknown) => z.object({ userId: z.uuid() }).parse(data))
  .handler(async ({ data }) => {
    const [ledger, totalMinutes] = await Promise.all([
      listLedgerForUser(data.userId),
      totalMinutesForUser(await getDb(), data.userId),
    ])
    return { ledger, totalMinutes }
  })

/**
 * Issues a fresh summary certificate covering the member's whole record. The
 * member requests it for themselves; admins can issue one on their behalf.
 */
export const createSummaryCertificate = createServerFn({ method: 'POST' })
  .middleware([approvedMiddleware])
  .validator((data: unknown) =>
    z.object({ userId: z.uuid().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const targetUserId = data.userId ?? context.viewer.id
    const isSelf = targetUserId === context.viewer.id

    if (!isSelf && !can(toPermissionViewer(context.viewer), 'requests.view_all')) {
      throw forbidden()
    }
    if (isSelf && !can(toPermissionViewer(context.viewer), 'requests.view_own')) {
      throw forbidden()
    }

    const certificate = await issueSummaryCertificate(targetUserId)
    return { certificateId: certificate.id, verificationId: certificate.verificationId }
  })
