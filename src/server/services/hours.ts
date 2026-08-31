import { and, desc, eq, sql } from 'drizzle-orm'
import { notFound } from '~/lib/errors'
import { hoursToMinutes } from '~/lib/hours'
import { getDb, schema, type Executor } from '../db'
import { generateVerificationId } from '../tokens'
import { dispatchNotification, emailBrand, queueNotification } from '../email'
import { hoursAdjustedEmail } from '../email/templates'
import { recordAudit } from './audit'

export async function totalMinutesForUser(
  executor: Executor,
  userId: string,
): Promise<number> {
  const rows = await executor
    .select({ total: sql<number>`coalesce(sum(${schema.hourLedger.minutes}), 0)::int` })
    .from(schema.hourLedger)
    .where(eq(schema.hourLedger.userId, userId))
  return rows[0]?.total ?? 0
}

export type LedgerRow = {
  id: string
  kind: 'award' | 'adjustment'
  minutes: number
  reason: string | null
  createdAt: Date
  requestId: string | null
  serviceDate: string | null
  activity: string | null
  certificateId: string | null
  verificationId: string | null
  postedByName: string | null
}

export async function listLedgerForUser(userId: string): Promise<Array<LedgerRow>> {
  const db = await getDb()

  const rows = await db
    .select({
      id: schema.hourLedger.id,
      kind: schema.hourLedger.kind,
      minutes: schema.hourLedger.minutes,
      reason: schema.hourLedger.reason,
      createdAt: schema.hourLedger.createdAt,
      requestId: schema.hourLedger.requestId,
      serviceDate: schema.volunteerRequests.serviceDate,
      activity: schema.volunteerRequests.activity,
      certificateId: schema.certificates.id,
      verificationId: schema.certificates.verificationId,
      postedByFirstName: schema.users.firstName,
      postedByLastName: schema.users.lastName,
      postedByEmail: schema.users.email,
    })
    .from(schema.hourLedger)
    .leftJoin(
      schema.volunteerRequests,
      eq(schema.hourLedger.requestId, schema.volunteerRequests.id),
    )
    .leftJoin(
      schema.certificates,
      and(
        eq(schema.certificates.awardId, schema.hourLedger.id),
        eq(schema.certificates.scope, 'award'),
      ),
    )
    .leftJoin(schema.users, eq(schema.hourLedger.createdBy, schema.users.id))
    .where(eq(schema.hourLedger.userId, userId))
    .orderBy(desc(schema.hourLedger.createdAt))

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    minutes: row.minutes,
    reason: row.reason,
    createdAt: row.createdAt,
    requestId: row.requestId,
    serviceDate: row.serviceDate,
    activity: row.activity,
    certificateId: row.certificateId,
    verificationId: row.verificationId,
    postedByName: row.postedByEmail
      ? [row.postedByFirstName, row.postedByLastName].filter(Boolean).join(' ') ||
        row.postedByEmail
      : null,
  }))
}

export async function issueAwardCertificate(
  executor: Executor,
  input: {
    userId: string
    awardId: string
    totalMinutes: number
    serviceDate: string
  },
) {
  const rows = await executor
    .insert(schema.certificates)
    .values({
      verificationId: generateVerificationId(),
      userId: input.userId,
      scope: 'award',
      awardId: input.awardId,
      totalMinutes: input.totalMinutes,
      periodStart: input.serviceDate,
      periodEnd: input.serviceDate,
    })
    .returning()

  return rows[0]!
}

/**
 * Summary certificates cover a member's whole record, so a fresh one is issued
 * each time the totals could have changed.
 */
export async function issueSummaryCertificate(userId: string) {
  const db = await getDb()

  return db.transaction(async (tx) => {
    const total = await totalMinutesForUser(tx, userId)

    const range = await tx
      .select({
        first: sql<string | null>`min(${schema.volunteerRequests.serviceDate})`,
        last: sql<string | null>`max(${schema.volunteerRequests.serviceDate})`,
      })
      .from(schema.hourLedger)
      .leftJoin(
        schema.volunteerRequests,
        eq(schema.hourLedger.requestId, schema.volunteerRequests.id),
      )
      .where(eq(schema.hourLedger.userId, userId))

    const rows = await tx
      .insert(schema.certificates)
      .values({
        verificationId: generateVerificationId(),
        userId,
        scope: 'summary',
        totalMinutes: total,
        periodStart: range[0]?.first ?? null,
        periodEnd: range[0]?.last ?? null,
      })
      .returning()

    return rows[0]!
  })
}

export type CertificateDetail = {
  verificationId: string
  scope: 'award' | 'summary'
  totalMinutes: number
  periodStart: string | null
  periodEnd: string | null
  issuedAt: Date
  memberName: string
  memberId: string
  activity: string | null
  /** Reflects the live ledger, so a later correction is visible to the school. */
  currentTotalMinutes: number
  memberStatus: 'pending' | 'approved' | 'suspended'
}

export async function getCertificateByVerificationId(
  verificationId: string,
): Promise<CertificateDetail | null> {
  const db = await getDb()

  const rows = await db
    .select({
      certificate: schema.certificates,
      memberFirstName: schema.users.firstName,
      memberLastName: schema.users.lastName,
      memberEmail: schema.users.email,
      memberStatus: schema.users.status,
      activity: schema.volunteerRequests.activity,
    })
    .from(schema.certificates)
    .innerJoin(schema.users, eq(schema.certificates.userId, schema.users.id))
    .leftJoin(schema.hourLedger, eq(schema.certificates.awardId, schema.hourLedger.id))
    .leftJoin(
      schema.volunteerRequests,
      eq(schema.hourLedger.requestId, schema.volunteerRequests.id),
    )
    .where(eq(schema.certificates.verificationId, verificationId.toUpperCase()))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const currentTotal = await totalMinutesForUser(db, row.certificate.userId)

  return {
    verificationId: row.certificate.verificationId,
    scope: row.certificate.scope,
    totalMinutes: row.certificate.totalMinutes,
    periodStart: row.certificate.periodStart,
    periodEnd: row.certificate.periodEnd,
    issuedAt: row.certificate.issuedAt,
    memberId: row.certificate.userId,
    memberName:
      [row.memberFirstName, row.memberLastName].filter(Boolean).join(' ') ||
      row.memberEmail,
    activity: row.activity,
    currentTotalMinutes: currentTotal,
    memberStatus: row.memberStatus,
  }
}

export async function getCertificateById(certificateId: string) {
  const db = await getDb()
  const rows = await db
    .select()
    .from(schema.certificates)
    .where(eq(schema.certificates.id, certificateId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Corrections are posted as new ledger entries; awarded history is never
 * rewritten so a certificate issued earlier stays explainable.
 */
export async function createAdjustment(input: {
  actorId: string
  userId: string
  hours: number
  reason: string
}): Promise<void> {
  const db = await getDb()

  const queued = await db.transaction(async (tx) => {
    const memberRows = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1)
    const member = memberRows[0]
    if (!member) throw notFound('That member no longer exists.')

    const minutes = hoursToMinutes(input.hours)

    await tx.insert(schema.hourLedger).values({
      userId: member.id,
      kind: 'adjustment',
      minutes,
      reason: input.reason,
      createdBy: input.actorId,
    })

    const total = await totalMinutesForUser(tx, member.id)

    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'hours.adjusted',
      entityType: 'user',
      entityId: member.id,
      metadata: { minutes, reason: input.reason, totalAfter: total },
    })

    const content = hoursAdjustedEmail({
      brand: emailBrand(),
      memberName: member.firstName ?? member.email,
      minutes,
      reason: input.reason,
      totalMinutes: total,
    })

    const notificationId = await queueNotification(tx, {
      userId: member.id,
      type: 'hours.adjusted',
      toEmail: member.email,
      content,
    })

    return { notificationId, content }
  })

  await dispatchNotification(queued.notificationId, queued.content)
}