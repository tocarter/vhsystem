import crypto from 'node:crypto'
import { and, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { conflict, forbidden, invalid, notFound } from '~/lib/errors'
import { hoursToMinutes } from '~/lib/hours'
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  isAllowedImageType,
} from '~/lib/validation'
import type { RequestInput } from '~/lib/validation'
import { getDb, schema } from '../db'
import { dispatchNotification, emailBrand, queueNotification } from '../email'
import { hoursApprovedEmail, requestDeclinedEmail } from '../email/templates'
import { buildAttachmentKey, getStorage } from '../storage'
import { recordAudit } from './audit'
import { issueAwardCertificate, totalMinutesForUser } from './hours'

export type UploadFile = {
  fileName: string
  contentType: string
  bytes: Buffer
}

function assertFilesAcceptable(files: Array<UploadFile>, existingCount = 0) {
  if (files.length + existingCount > MAX_ATTACHMENTS) {
    throw invalid(`Attach at most ${MAX_ATTACHMENTS} photos.`)
  }
  for (const file of files) {
    if (!isAllowedImageType(file.contentType)) {
      throw invalid('Only JPEG, PNG, WebP or HEIC images are accepted.')
    }
    if (file.bytes.byteLength === 0) {
      throw invalid('One of the photos was empty.')
    }
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw invalid('Each photo must be 8 MB or smaller.')
    }
  }
}

export async function createRequest(input: {
  userId: string
  data: RequestInput
  files: Array<UploadFile>
}): Promise<string> {
  assertFilesAcceptable(input.files)

  const db = await getDb()
  const requestId = crypto.randomUUID()
  const storage = getStorage()
  const uploaded: Array<{
    storageKey: string
    fileName: string
    contentType: string
    sizeBytes: number
  }> = []

  // Objects are written first so the row never references a missing file; any
  // failure below removes them again.
  try {
    for (const file of input.files) {
      const storageKey = buildAttachmentKey(requestId, file.contentType)
      await storage.put(storageKey, file.bytes, file.contentType)
      uploaded.push({
        storageKey,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.bytes.byteLength,
      })
    }

    await db.transaction(async (tx) => {
      const userRows = await tx
        .select({ status: schema.users.status })
        .from(schema.users)
        .where(eq(schema.users.id, input.userId))
        .limit(1)
      if (userRows[0]?.status !== 'approved') {
        throw forbidden('Only approved members can submit volunteer hours.')
      }

      await tx.insert(schema.volunteerRequests).values({
        id: requestId,
        userId: input.userId,
        serviceDate: input.data.serviceDate,
        activity: input.data.activity,
        minutes: hoursToMinutes(input.data.hours),
        notes: input.data.notes || null,
      })

      if (uploaded.length > 0) {
        await tx
          .insert(schema.requestAttachments)
          .values(uploaded.map((file) => ({ requestId, ...file })))
      }

      await recordAudit(tx, {
        actorId: input.userId,
        action: 'request.submitted',
        entityType: 'request',
        entityId: requestId,
        metadata: { hours: input.data.hours, attachments: uploaded.length },
      })
    })
  } catch (error) {
    await Promise.all(
      uploaded.map((file) => storage.remove(file.storageKey).catch(() => {})),
    )
    throw error
  }

  return requestId
}

export async function updateRequest(input: {
  userId: string
  requestId: string
  data: RequestInput
  files: Array<UploadFile>
  removeAttachmentIds: Array<string>
}): Promise<void> {
  const db = await getDb()
  const storage = getStorage()

  const existing = await db
    .select()
    .from(schema.volunteerRequests)
    .where(eq(schema.volunteerRequests.id, input.requestId))
    .limit(1)

  const request = existing[0]
  if (!request) throw notFound('That request no longer exists.')
  if (request.userId !== input.userId) throw forbidden()
  if (request.status === 'approved' || request.status === 'declined') {
    throw conflict('A decided request can no longer be edited.')
  }

  const currentAttachments = await db
    .select()
    .from(schema.requestAttachments)
    .where(eq(schema.requestAttachments.requestId, request.id))

  const removing = currentAttachments.filter((a) =>
    input.removeAttachmentIds.includes(a.id),
  )
  const keepingCount = currentAttachments.length - removing.length
  assertFilesAcceptable(input.files, keepingCount)

  const uploaded: Array<{
    storageKey: string
    fileName: string
    contentType: string
    sizeBytes: number
  }> = []

  try {
    for (const file of input.files) {
      const storageKey = buildAttachmentKey(request.id, file.contentType)
      await storage.put(storageKey, file.bytes, file.contentType)
      uploaded.push({
        storageKey,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.bytes.byteLength,
      })
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.volunteerRequests)
        .set({
          serviceDate: input.data.serviceDate,
          activity: input.data.activity,
          minutes: hoursToMinutes(input.data.hours),
          notes: input.data.notes || null,
          // Resubmitting returns the request to the review queue.
          status: 'pending',
          reviewNote: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.volunteerRequests.id, request.id))

      if (removing.length > 0) {
        await tx.delete(schema.requestAttachments).where(
          inArray(
            schema.requestAttachments.id,
            removing.map((a) => a.id),
          ),
        )
      }

      if (uploaded.length > 0) {
        await tx
          .insert(schema.requestAttachments)
          .values(uploaded.map((file) => ({ requestId: request.id, ...file })))
      }

      await recordAudit(tx, {
        actorId: input.userId,
        action: 'request.updated',
        entityType: 'request',
        entityId: request.id,
      })
    })
  } catch (error) {
    await Promise.all(
      uploaded.map((file) => storage.remove(file.storageKey).catch(() => {})),
    )
    throw error
  }

  await Promise.all(
    removing.map((file) => storage.remove(file.storageKey).catch(() => {})),
  )
}

export type AttachmentRow = {
  id: string
  fileName: string
  contentType: string
  sizeBytes: number
}

export type RequestRow = {
  id: string
  userId: string
  memberName: string
  memberEmail: string
  memberAvatarUrl: string | null
  serviceDate: string
  activity: string
  minutes: number
  notes: string | null
  status: 'pending' | 'approved' | 'declined' | 'changes_requested'
  reviewNote: string | null
  reviewerName: string | null
  decidedAt: Date | null
  createdAt: Date
  awardedMinutes: number | null
  attachments: Array<AttachmentRow>
}

const reviewerUser = alias(schema.users, 'reviewer')

async function loadRequests(where: SQL | undefined): Promise<Array<RequestRow>> {
  const db = await getDb()

  const rows = await db
    .select({
      id: schema.volunteerRequests.id,
      userId: schema.volunteerRequests.userId,
      serviceDate: schema.volunteerRequests.serviceDate,
      activity: schema.volunteerRequests.activity,
      minutes: schema.volunteerRequests.minutes,
      notes: schema.volunteerRequests.notes,
      status: schema.volunteerRequests.status,
      reviewNote: schema.volunteerRequests.reviewNote,
      decidedAt: schema.volunteerRequests.decidedAt,
      createdAt: schema.volunteerRequests.createdAt,
      memberFirstName: schema.users.firstName,
      memberLastName: schema.users.lastName,
      memberEmail: schema.users.email,
      memberAvatarUrl: schema.users.avatarUrl,
      reviewerFirstName: reviewerUser.firstName,
      reviewerLastName: reviewerUser.lastName,
      reviewerEmail: reviewerUser.email,
      awardedMinutes: schema.hourLedger.minutes,
    })
    .from(schema.volunteerRequests)
    .innerJoin(schema.users, eq(schema.volunteerRequests.userId, schema.users.id))
    .leftJoin(
      reviewerUser,
      eq(reviewerUser.id, schema.volunteerRequests.reviewerId),
    )
    .leftJoin(
      schema.hourLedger,
      and(
        eq(schema.hourLedger.requestId, schema.volunteerRequests.id),
        eq(schema.hourLedger.kind, 'award'),
      ),
    )
    .where(where)
    .orderBy(desc(schema.volunteerRequests.createdAt))

  if (rows.length === 0) return []

  const attachments = await db
    .select()
    .from(schema.requestAttachments)
    .where(
      inArray(
        schema.requestAttachments.requestId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(schema.requestAttachments.createdAt)

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    memberName:
      [row.memberFirstName, row.memberLastName].filter(Boolean).join(' ') ||
      row.memberEmail,
    memberEmail: row.memberEmail,
    memberAvatarUrl: row.memberAvatarUrl,
    serviceDate: row.serviceDate,
    activity: row.activity,
    minutes: row.minutes,
    notes: row.notes,
    status: row.status,
    reviewNote: row.reviewNote,
    reviewerName: row.reviewerEmail
      ? [row.reviewerFirstName, row.reviewerLastName].filter(Boolean).join(' ') ||
        row.reviewerEmail
      : null,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    awardedMinutes: row.awardedMinutes,
    attachments: attachments
      .filter((a) => a.requestId === row.id)
      .map((a) => ({
        id: a.id,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
  }))
}

export async function listRequestsForUser(userId: string) {
  return loadRequests(eq(schema.volunteerRequests.userId, userId))
}

export async function listAllRequests(options: {
  status?: 'pending' | 'approved' | 'declined' | 'changes_requested'
} = {}) {
  return loadRequests(
    options.status ? eq(schema.volunteerRequests.status, options.status) : undefined,
  )
}

export async function getRequest(requestId: string): Promise<RequestRow | null> {
  const rows = await loadRequests(eq(schema.volunteerRequests.id, requestId))
  return rows[0] ?? null
}

/**
 * Same member, same service date. Surfaced to reviewers so the same shift is
 * not credited twice through two separate submissions.
 */
export async function findPotentialDuplicates(input: {
  userId: string
  serviceDate: string
  excludeRequestId: string
}): Promise<Array<{ id: string; activity: string; minutes: number; status: string }>> {
  const db = await getDb()
  return db
    .select({
      id: schema.volunteerRequests.id,
      activity: schema.volunteerRequests.activity,
      minutes: schema.volunteerRequests.minutes,
      status: schema.volunteerRequests.status,
    })
    .from(schema.volunteerRequests)
    .where(
      and(
        eq(schema.volunteerRequests.userId, input.userId),
        eq(schema.volunteerRequests.serviceDate, input.serviceDate),
        ne(schema.volunteerRequests.id, input.excludeRequestId),
        or(
          eq(schema.volunteerRequests.status, 'approved'),
          eq(schema.volunteerRequests.status, 'pending'),
        )!,
      ),
    )
}

export async function reviewRequest(input: {
  actorId: string
  requestId: string
  decision: 'approved' | 'declined' | 'changes_requested'
  reviewNote?: string
  approvedHours?: number
}): Promise<void> {
  const db = await getDb()

  const queued = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.volunteerRequests)
      .where(eq(schema.volunteerRequests.id, input.requestId))
      .limit(1)
      // Serializes two admins deciding the same request at the same moment.
      .for('update')

    const request = rows[0]
    if (!request) throw notFound('That request no longer exists.')
    if (request.status === 'approved') {
      throw conflict('These hours have already been awarded.')
    }
    if (request.status === 'declined' && input.decision === 'declined') {
      throw conflict('That request was already declined.')
    }
    if (request.userId === input.actorId) {
      throw forbidden('You cannot review your own volunteer hours.')
    }

    const memberRows = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, request.userId))
      .limit(1)
    const member = memberRows[0]
    if (!member) throw notFound('That member no longer exists.')

    const now = new Date()
    const awardedMinutes =
      input.approvedHours === undefined
        ? request.minutes
        : hoursToMinutes(input.approvedHours)

    await tx
      .update(schema.volunteerRequests)
      .set({
        status: input.decision,
        reviewerId: input.actorId,
        reviewNote: input.reviewNote || null,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.volunteerRequests.id, request.id))

    const memberName = member.firstName ?? member.email

    if (input.decision !== 'approved') {
      await recordAudit(tx, {
        actorId: input.actorId,
        action: `request.${input.decision}`,
        entityType: 'request',
        entityId: request.id,
        metadata: { userId: member.id, note: input.reviewNote ?? null },
      })

      const content = requestDeclinedEmail({
        brand: emailBrand(),
        memberName,
        serviceDate: request.serviceDate,
        activity: request.activity,
        reviewNote: input.reviewNote || null,
        changesRequested: input.decision === 'changes_requested',
      })

      const notificationId = await queueNotification(tx, {
        userId: member.id,
        type: `request.${input.decision}`,
        toEmail: member.email,
        content,
      })

      return { notificationId, content }
    }

    const award = await tx
      .insert(schema.hourLedger)
      .values({
        userId: member.id,
        requestId: request.id,
        kind: 'award',
        minutes: awardedMinutes,
        createdBy: input.actorId,
      })
      .returning({ id: schema.hourLedger.id })

    const awardId = award[0]!.id
    const total = await totalMinutesForUser(tx, member.id)

    const certificate = await issueAwardCertificate(tx, {
      userId: member.id,
      awardId,
      totalMinutes: awardedMinutes,
      serviceDate: request.serviceDate,
    })

    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'request.approved',
      entityType: 'request',
      entityId: request.id,
      metadata: {
        userId: member.id,
        awardedMinutes,
        requestedMinutes: request.minutes,
        verificationId: certificate.verificationId,
      },
    })

    const content = hoursApprovedEmail({
      brand: emailBrand(),
      memberName,
      minutes: awardedMinutes,
      serviceDate: request.serviceDate,
      activity: request.activity,
      totalMinutes: total,
      verificationId: certificate.verificationId,
    })

    const notificationId = await queueNotification(tx, {
      userId: member.id,
      type: 'request.approved',
      toEmail: member.email,
      content,
    })

    return { notificationId, content }
  })

  await dispatchNotification(queued.notificationId, queued.content)
}

export async function getAttachment(attachmentId: string) {
  const db = await getDb()
  const rows = await db
    .select({
      attachment: schema.requestAttachments,
      requestUserId: schema.volunteerRequests.userId,
    })
    .from(schema.requestAttachments)
    .innerJoin(
      schema.volunteerRequests,
      eq(schema.requestAttachments.requestId, schema.volunteerRequests.id),
    )
    .where(eq(schema.requestAttachments.id, attachmentId))
    .limit(1)

  return rows[0] ?? null
}