import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { forbidden, invalid, notFound } from '~/lib/errors'
import { can } from '~/lib/permissions'
import {
  MAX_ATTACHMENTS,
  requestInputSchema,
  reviewDecisionSchema,
} from '~/lib/validation'
import { toPermissionViewer } from '../auth/viewer'
import {
  createRequest,
  findPotentialDuplicates,
  getRequest,
  listAllRequests,
  listRequestsForUser,
  reviewRequest,
  updateRequest,
  type RequestRow,
  type UploadFile,
} from '../services/requests'
import { listApplications } from '../services/members'
import { listLedgerForUser, totalMinutesForUser } from '../services/hours'
import { getDb } from '../db'
import { attachmentUrl } from './attachments'
import {
  approvedMiddleware,
  authedMiddleware,
  permissionMiddleware,
  rateLimitMiddleware,
} from './middleware'

export type RequestView = Omit<RequestRow, 'attachments'> & {
  attachments: Array<{
    id: string
    fileName: string
    contentType: string
    sizeBytes: number
    url: string
  }>
}

function withAttachmentUrls(
  rows: Array<RequestRow>,
  viewerId: string,
): Array<RequestView> {
  return rows.map((row) => ({
    ...row,
    attachments: row.attachments.map((attachment) => ({
      ...attachment,
      url: attachmentUrl(attachment.id, viewerId),
    })),
  }))
}

function asFormData(data: unknown): FormData {
  if (!(data instanceof FormData)) {
    throw invalid('Expected a form submission.')
  }
  return data
}

function readField(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

async function readFiles(form: FormData): Promise<Array<UploadFile>> {
  const entries = form.getAll('photos').filter((entry): entry is File => entry instanceof File)
  if (entries.length > MAX_ATTACHMENTS) {
    throw invalid(`Attach at most ${MAX_ATTACHMENTS} photos.`)
  }

  const files: Array<UploadFile> = []
  for (const entry of entries) {
    if (entry.size === 0) continue
    files.push({
      fileName: entry.name || 'photo',
      contentType: entry.type,
      bytes: Buffer.from(await entry.arrayBuffer()),
    })
  }
  return files
}

function parseRequestFields(form: FormData) {
  const rawHours = readField(form, 'hours')
  return requestInputSchema().parse({
    serviceDate: readField(form, 'serviceDate'),
    activity: readField(form, 'activity'),
    hours: rawHours === '' ? Number.NaN : Number(rawHours),
    notes: readField(form, 'notes'),
  })
}

export const submitVolunteerRequest = createServerFn({ method: 'POST' })
  .middleware([
    rateLimitMiddleware({ key: 'request-submit', max: 30, windowMs: 60 * 60_000 }),
    approvedMiddleware,
  ])
  .validator(asFormData)
  .handler(async ({ data, context }) => {
    if (!can(toPermissionViewer(context.viewer), 'requests.submit')) {
      throw forbidden()
    }
    const fields = parseRequestFields(data)
    const files = await readFiles(data)
    const requestId = await createRequest({
      userId: context.viewer.id,
      data: fields,
      files,
    })
    return { requestId }
  })

export const updateVolunteerRequest = createServerFn({ method: 'POST' })
  .middleware([approvedMiddleware])
  .validator(asFormData)
  .handler(async ({ data, context }) => {
    if (!can(toPermissionViewer(context.viewer), 'requests.submit')) {
      throw forbidden()
    }
    const requestId = z.uuid().parse(readField(data, 'requestId'))
    const fields = parseRequestFields(data)
    const files = await readFiles(data)
    const removeAttachmentIds = data
      .getAll('removeAttachmentIds')
      .filter((entry): entry is string => typeof entry === 'string')

    await updateRequest({
      userId: context.viewer.id,
      requestId,
      data: fields,
      files,
      removeAttachmentIds,
    })
    return { ok: true as const }
  })

export const fetchMyDashboard = createServerFn({ method: 'GET' })
  .middleware([approvedMiddleware])
  .handler(async ({ context }) => {
    const viewer = context.viewer
    if (!can(toPermissionViewer(viewer), 'requests.view_own')) {
      throw forbidden()
    }

    const [requests, ledger, totalMinutes] = await Promise.all([
      listRequestsForUser(viewer.id),
      listLedgerForUser(viewer.id),
      totalMinutesForUser(await getDb(), viewer.id),
    ])

    return {
      requests: withAttachmentUrls(requests, viewer.id),
      ledger,
      totalMinutes,
    }
  })

export const fetchMyRequest = createServerFn({ method: 'GET' })
  .middleware([approvedMiddleware])
  .validator((data: unknown) => z.object({ requestId: z.uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const request = await getRequest(data.requestId)
    if (!request) throw notFound('That request no longer exists.')

    const isOwner = request.userId === context.viewer.id
    if (!isOwner && !can(toPermissionViewer(context.viewer), 'requests.view_all')) {
      throw forbidden()
    }

    return withAttachmentUrls([request], context.viewer.id)[0]!
  })

export const fetchReviewQueue = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(async ({ context }) => {
    const viewer = toPermissionViewer(context.viewer)
    const canReviewRequests = can(viewer, 'requests.review')
    const canReviewMembers = can(viewer, 'members.review')

    if (!canReviewRequests && !canReviewMembers) throw forbidden()

    const [pendingRequests, pendingApplications] = await Promise.all([
      canReviewRequests ? listAllRequests({ status: 'pending' }) : Promise.resolve([]),
      canReviewMembers ? listApplications('pending') : Promise.resolve([]),
    ])

    return {
      pendingRequests: withAttachmentUrls(pendingRequests, context.viewer.id),
      pendingApplications,
      canReviewRequests,
      canReviewMembers,
    }
  })

export const fetchRequestForReview = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('requests.view_all')])
  .validator((data: unknown) => z.object({ requestId: z.uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const request = await getRequest(data.requestId)
    if (!request) throw notFound('That request no longer exists.')

    const [duplicates, memberTotal] = await Promise.all([
      findPotentialDuplicates({
        userId: request.userId,
        serviceDate: request.serviceDate,
        excludeRequestId: request.id,
      }),
      totalMinutesForUser(await getDb(), request.userId),
    ])

    return {
      request: withAttachmentUrls([request], context.viewer.id)[0]!,
      duplicates,
      memberTotalMinutes: memberTotal,
    }
  })

export const decideVolunteerRequest = createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('requests.review')])
  .validator((data: unknown) => reviewDecisionSchema.parse(data))
  .handler(async ({ data, context }) => {
    await reviewRequest({
      actorId: context.viewer.id,
      requestId: data.requestId,
      decision: data.decision,
      reviewNote: data.reviewNote || undefined,
      approvedHours: data.approvedHours,
    })
    return { ok: true as const }
  })
