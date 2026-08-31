import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { conflict, forbidden, invalid, notFound } from '~/lib/errors'
import { SYSTEM_ROLE_KEYS } from '~/lib/permissions'
import type { ApplicationInput } from '~/lib/validation'
import { getDb, schema, type Executor } from '../db'
import { bootstrapAdminEmails } from '../env'
import { revokeAllSessionsForUser } from '../auth/session'
import type { GoogleClaims } from '../auth/google'
import {
  dispatchNotification,
  emailBrand,
  queueNotification,
} from '../email'
import {
  applicationApprovedEmail,
  applicationDeclinedEmail,
} from '../email/templates'
import { recordAudit } from './audit'
import { assertAdminRemains, ensureSystemRoles, requireRoleByKey } from './roles'

function splitName(fullName: string | undefined) {
  if (!fullName) return { firstName: null, lastName: null }
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: null, lastName: null }
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  }
}

/**
 * Resolves the local account for a verified Google identity, matching on the
 * stable subject rather than email so a Google address change never orphans a
 * member's hour history.
 */
export async function signInWithGoogle(claims: GoogleClaims): Promise<string> {
  const db = await getDb()

  return db.transaction(async (tx) => {
    await ensureSystemRoles(tx)

    const existing = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.googleSub, claims.sub))
      .limit(1)

    const now = new Date()

    // Same Google account (stable subject) always wins. If that misses, fall
    // back to the verified email so a returning member is not treated as new.
    const matched =
      existing[0] ??
      (
        await tx
          .select()
          .from(schema.users)
          .where(sql`lower(${schema.users.email}) = ${claims.email.toLowerCase()}`)
          .limit(1)
      )[0]

    if (matched) {
      const user = matched
      await tx
        .update(schema.users)
        .set({
          googleSub: claims.sub,
          email: claims.email,
          emailVerified: claims.emailVerified,
          googleName: claims.name ?? user.googleName,
          avatarUrl: claims.picture ?? user.avatarUrl,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(schema.users.id, user.id))

      await recordAudit(tx, {
        actorId: user.id,
        action: 'auth.signed_in',
        entityType: 'user',
        entityId: user.id,
      })

      return user.id
    }

    const isBootstrapAdmin = bootstrapAdminEmails().includes(
      claims.email.toLowerCase(),
    )
    const role = await requireRoleByKey(
      tx,
      isBootstrapAdmin ? SYSTEM_ROLE_KEYS.admin : SYSTEM_ROLE_KEYS.member,
    )
    const { firstName, lastName } = splitName(claims.name)

    const inserted = await tx
      .insert(schema.users)
      .values({
        googleSub: claims.sub,
        email: claims.email,
        emailVerified: claims.emailVerified,
        googleName: claims.name ?? null,
        avatarUrl: claims.picture ?? null,
        firstName: isBootstrapAdmin ? firstName : null,
        lastName: isBootstrapAdmin ? lastName : null,
        roleId: role.id,
        status: isBootstrapAdmin ? 'approved' : 'pending',
        approvedAt: isBootstrapAdmin ? now : null,
        lastLoginAt: now,
      })
      .returning({ id: schema.users.id })

    const userId = inserted[0]!.id

    await recordAudit(tx, {
      actorId: userId,
      action: isBootstrapAdmin ? 'auth.bootstrap_admin' : 'auth.registered',
      entityType: 'user',
      entityId: userId,
      metadata: { email: claims.email },
    })

    return userId
  })
}

export async function submitApplication(input: {
  userId: string
  data: ApplicationInput
}): Promise<string> {
  const db = await getDb()

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1)
    const user = rows[0]
    if (!user) throw notFound('Your account no longer exists.')
    if (user.status === 'suspended') {
      throw forbidden('Your membership is suspended.')
    }
    if (user.status === 'approved') {
      throw conflict('You are already an approved member.')
    }

    const pending = await tx
      .select({ id: schema.membershipApplications.id })
      .from(schema.membershipApplications)
      .where(
        and(
          eq(schema.membershipApplications.userId, user.id),
          eq(schema.membershipApplications.status, 'pending'),
        ),
      )
      .limit(1)
    if (pending.length > 0) {
      throw conflict('Your registration is already waiting for review.')
    }

    const inserted = await tx
      .insert(schema.membershipApplications)
      .values({
        userId: user.id,
        firstName: input.data.firstName,
        lastName: input.data.lastName,
        discordHandle: input.data.discordHandle,
        phone: input.data.phone || null,
      })
      .returning({ id: schema.membershipApplications.id })

    // Mirror the submitted details so admins see them on the member record.
    await tx
      .update(schema.users)
      .set({
        firstName: input.data.firstName,
        lastName: input.data.lastName,
        discordHandle: input.data.discordHandle,
        phone: input.data.phone || null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, user.id))

    const applicationId = inserted[0]!.id

    await recordAudit(tx, {
      actorId: user.id,
      action: 'application.submitted',
      entityType: 'application',
      entityId: applicationId,
    })

    return applicationId
  })
}

export type ApplicationRow = {
  id: string
  userId: string
  firstName: string
  lastName: string
  discordHandle: string
  phone: string | null
  email: string
  avatarUrl: string | null
  status: 'pending' | 'approved' | 'declined'
  decisionNote: string | null
  createdAt: Date
  decidedAt: Date | null
}

export async function listApplications(
  status?: 'pending' | 'approved' | 'declined',
): Promise<Array<ApplicationRow>> {
  const db = await getDb()
  const rows = await db
    .select({
      id: schema.membershipApplications.id,
      userId: schema.membershipApplications.userId,
      firstName: schema.membershipApplications.firstName,
      lastName: schema.membershipApplications.lastName,
      discordHandle: schema.membershipApplications.discordHandle,
      phone: schema.membershipApplications.phone,
      status: schema.membershipApplications.status,
      decisionNote: schema.membershipApplications.decisionNote,
      createdAt: schema.membershipApplications.createdAt,
      decidedAt: schema.membershipApplications.decidedAt,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.membershipApplications)
    .innerJoin(schema.users, eq(schema.membershipApplications.userId, schema.users.id))
    .where(status ? eq(schema.membershipApplications.status, status) : undefined)
    .orderBy(desc(schema.membershipApplications.createdAt))

  return rows
}

export async function decideApplication(input: {
  actorId: string
  applicationId: string
  decision: 'approved' | 'declined'
  decisionNote?: string
}): Promise<void> {
  const db = await getDb()

  const queued = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.membershipApplications)
      .where(eq(schema.membershipApplications.id, input.applicationId))
      .limit(1)
    const application = rows[0]
    if (!application) throw notFound('That registration no longer exists.')
    if (application.status !== 'pending') {
      throw conflict('That registration has already been decided.')
    }

    const userRows = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, application.userId))
      .limit(1)
    const user = userRows[0]
    if (!user) throw notFound('That member no longer exists.')

    const now = new Date()

    await tx
      .update(schema.membershipApplications)
      .set({
        status: input.decision,
        decisionNote: input.decisionNote || null,
        decidedBy: input.actorId,
        decidedAt: now,
      })
      .where(eq(schema.membershipApplications.id, application.id))

    if (input.decision === 'approved') {
      await tx
        .update(schema.users)
        .set({
          status: 'approved',
          approvedAt: now,
          firstName: application.firstName,
          lastName: application.lastName,
          discordHandle: application.discordHandle,
          phone: application.phone,
          updatedAt: now,
        })
        .where(eq(schema.users.id, user.id))
    }

    await recordAudit(tx, {
      actorId: input.actorId,
      action:
        input.decision === 'approved'
          ? 'application.approved'
          : 'application.declined',
      entityType: 'application',
      entityId: application.id,
      metadata: { userId: user.id, note: input.decisionNote ?? null },
    })

    const memberName = application.firstName
    const content =
      input.decision === 'approved'
        ? applicationApprovedEmail({ brand: emailBrand(), memberName })
        : applicationDeclinedEmail({
            brand: emailBrand(),
            memberName,
            decisionNote: input.decisionNote || null,
          })

    const notificationId = await queueNotification(tx, {
      userId: user.id,
      type: `application.${input.decision}`,
      toEmail: user.email,
      content,
    })

    return { notificationId, content }
  })

  await dispatchNotification(queued.notificationId, queued.content)
}

export type MemberRow = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  discordHandle: string | null
  phone: string | null
  avatarUrl: string | null
  status: 'pending' | 'approved' | 'suspended'
  roleId: string
  roleKey: string
  roleName: string
  approvedAt: Date | null
  createdAt: Date
  totalMinutes: number
}

export async function listMembers(options: {
  status?: 'pending' | 'approved' | 'suspended'
  search?: string
} = {}): Promise<Array<MemberRow>> {
  const db = await getDb()

  const conditions = []
  if (options.status) conditions.push(eq(schema.users.status, options.status))

  const search = options.search?.trim()
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`
    conditions.push(
      or(
        ilike(schema.users.firstName, pattern),
        ilike(schema.users.lastName, pattern),
        ilike(schema.users.email, pattern),
        ilike(schema.users.discordHandle, pattern),
      )!,
    )
  }

  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      firstName: schema.users.firstName,
      lastName: schema.users.lastName,
      discordHandle: schema.users.discordHandle,
      phone: schema.users.phone,
      avatarUrl: schema.users.avatarUrl,
      status: schema.users.status,
      roleId: schema.roles.id,
      roleKey: schema.roles.key,
      roleName: schema.roles.name,
      approvedAt: schema.users.approvedAt,
      createdAt: schema.users.createdAt,
      totalMinutes: sql<number>`coalesce(sum(${schema.hourLedger.minutes}), 0)::int`,
    })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
    .leftJoin(schema.hourLedger, eq(schema.hourLedger.userId, schema.users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(schema.users.id, schema.roles.id)
    .orderBy(asc(schema.users.firstName), asc(schema.users.email))

  return rows
}

export async function getMember(userId: string): Promise<MemberRow | null> {
  const members = await listMembers()
  return members.find((member) => member.id === userId) ?? null
}

export async function setMemberStatus(input: {
  actorId: string
  userId: string
  status: 'approved' | 'suspended'
}): Promise<void> {
  const db = await getDb()

  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1)
    const user = rows[0]
    if (!user) throw notFound('That member no longer exists.')
    if (user.status === input.status) return

    if (user.status === 'pending') {
      throw invalid('Approve this member through their registration request.')
    }

    const now = new Date()
    await tx
      .update(schema.users)
      .set({
        status: input.status,
        suspendedAt: input.status === 'suspended' ? now : null,
        approvedAt: input.status === 'approved' ? (user.approvedAt ?? now) : user.approvedAt,
        updatedAt: now,
      })
      .where(eq(schema.users.id, user.id))

    await assertAdminRemains(tx)

    await recordAudit(tx, {
      actorId: input.actorId,
      action:
        input.status === 'suspended' ? 'member.suspended' : 'member.reactivated',
      entityType: 'user',
      entityId: user.id,
    })
  })

  if (input.status === 'suspended') {
    await revokeAllSessionsForUser(input.userId)
  }
}

