import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '~/server/db'
import { SYSTEM_ROLE_KEYS } from '~/lib/permissions'
import {
  decideApplication,
  listApplications,
  listMembers,
  setMemberStatus,
  signInWithGoogle,
  submitApplication,
} from '~/server/services/members'
import {
  createRequest,
  findPotentialDuplicates,
  getRequest,
  listRequestsForUser,
  reviewRequest,
  updateRequest,
} from '~/server/services/requests'
import {
  createAdjustment,
  getCertificateByVerificationId,
  issueSummaryCertificate,
  listLedgerForUser,
  totalMinutesForUser,
} from '~/server/services/hours'
import {
  assignRole,
  createRole,
  ensureSystemRoles,
  listRoles,
  requireRoleByKey,
  updateRole,
} from '~/server/services/roles'
import { createSession, findSessionUserId } from '~/server/auth/session'
import { loadViewer } from '~/server/auth/viewer'
import { listAuditEvents } from '~/server/services/audit'
import { createHarness, googleClaims, PIXEL_PNG, type Harness } from './helpers/harness'

let harness: Harness

beforeAll(async () => {
  harness = await createHarness()
})

afterAll(async () => {
  await harness.close()
})

beforeEach(async () => {
  await harness.reset()
  delete process.env.BOOTSTRAP_ADMIN_EMAILS
})

async function createAdmin(email = 'admin@example.org') {
  process.env.BOOTSTRAP_ADMIN_EMAILS = email
  const id = await signInWithGoogle(googleClaims({ email, name: 'Ada Admin' }))
  delete process.env.BOOTSTRAP_ADMIN_EMAILS
  return id
}

async function createApprovedMember(
  adminId: string,
  options: { email?: string; firstName?: string } = {},
) {
  const email = options.email ?? `member-${Math.random().toString(36).slice(2)}@gmail.com`
  const userId = await signInWithGoogle(googleClaims({ email }))

  await submitApplication({
    userId,
    data: {
      firstName: options.firstName ?? 'Nova',
      lastName: 'Hart',
      discordHandle: 'nova.hart',
      phone: '(555) 010-1234',
    },
  })

  const pending = await listApplications('pending')
  const application = pending.find((entry) => entry.userId === userId)!
  await decideApplication({
    actorId: adminId,
    applicationId: application.id,
    decision: 'approved',
  })

  return userId
}

async function submitHours(
  userId: string,
  overrides: Partial<{ serviceDate: string; activity: string; hours: number; photos: number }> = {},
) {
  return createRequest({
    userId,
    data: {
      serviceDate: overrides.serviceDate ?? '2026-06-10',
      activity: overrides.activity ?? 'Ran the registration desk at the food drive',
      hours: overrides.hours ?? 2.5,
    },
    files: Array.from({ length: overrides.photos ?? 2 }, (_, index) => ({
      fileName: `proof-${index}.png`,
      contentType: 'image/png',
      bytes: PIXEL_PNG,
    })),
  })
}

describe('sign-in and provisioning', () => {
  it('creates a pending member on first Google sign-in', async () => {
    const userId = await signInWithGoogle(googleClaims({ email: 'new@gmail.com' }))
    const viewer = await loadViewer(userId)

    expect(viewer?.status).toBe('pending')
    expect(viewer?.role.key).toBe(SYSTEM_ROLE_KEYS.member)
    expect(viewer?.permissions).not.toContain('requests.review')
  })

  it('provisions the very first administrator from the bootstrap list', async () => {
    const adminId = await createAdmin()
    const viewer = await loadViewer(adminId)

    expect(viewer?.status).toBe('approved')
    expect(viewer?.role.key).toBe(SYSTEM_ROLE_KEYS.admin)
    expect(viewer?.permissions).toContain('roles.manage')
  })

  it('matches on the Google subject, not the email, when an address changes', async () => {
    const claims = googleClaims({ email: 'before@gmail.com' })
    const first = await signInWithGoogle(claims)
    const second = await signInWithGoogle({ ...claims, email: 'after@gmail.com' })

    expect(second).toBe(first)

    const viewer = await loadViewer(first)
    expect(viewer?.email).toBe('after@gmail.com')

    const users = await harness.db.select().from(schema.users)
    expect(users).toHaveLength(1)
  })

  it('matches a returning member by verified email when the Google subject is new', async () => {
    const first = await signInWithGoogle(
      googleClaims({ sub: 'old-sub', email: 'nova@gmail.com' }),
    )
    const second = await signInWithGoogle(
      googleClaims({ sub: 'new-sub', email: 'nova@gmail.com' }),
    )

    expect(second).toBe(first)
    const users = await harness.db.select().from(schema.users)
    expect(users).toHaveLength(1)
    expect(users[0]!.googleSub).toBe('new-sub')
  })

  it('does not grant admin to a non-bootstrap address', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = 'admin@example.org'
    const userId = await signInWithGoogle(googleClaims({ email: 'someone@gmail.com' }))
    const viewer = await loadViewer(userId)

    expect(viewer?.role.key).toBe(SYSTEM_ROLE_KEYS.member)
    expect(viewer?.status).toBe('pending')
  })
})

describe('registration workflow', () => {
  it('lets a new Google account submit registration after sign-in', async () => {
    const userId = await signInWithGoogle(googleClaims())
    await submitApplication({
      userId,
      data: {
        firstName: 'Nova',
        lastName: 'Hart',
        discordHandle: 'nova.hart',
      },
    })

    const viewer = await loadViewer(userId)
    expect(viewer?.hasSubmittedApplication).toBe(true)
    expect(viewer?.firstName).toBe('Nova')
    expect(viewer?.discordHandle).toBe('nova.hart')
  })

  it('refuses a registration from an account that is already approved', async () => {
    const adminId = await createAdmin()
    await expect(
      submitApplication({
        userId: adminId,
        data: {
          firstName: 'Ada',
          lastName: 'Admin',
          discordHandle: 'ada.admin',
        },
      }),
    ).rejects.toThrow(/already an approved member/i)

    const applications = await listApplications()
    expect(applications).toHaveLength(0)
  })

  it('records a registration and blocks a second pending one', async () => {
    const userId = await signInWithGoogle(googleClaims())
    const data = {
      firstName: 'Nova',
      lastName: 'Hart',
      discordHandle: 'nova.hart',
    }

    await submitApplication({ userId, data })
    await expect(submitApplication({ userId, data })).rejects.toThrow(
      /already waiting for review/i,
    )
  })

  it('approves a member, copies their details and emails them', async () => {
    const adminId = await createAdmin()
    harness.emails.length = 0

    const memberId = await createApprovedMember(adminId, { firstName: 'Nova' })
    const viewer = await loadViewer(memberId)

    expect(viewer?.status).toBe('approved')
    expect(viewer?.firstName).toBe('Nova')
    expect(viewer?.discordHandle).toBe('nova.hart')

    const email = harness.emails.at(-1)
    expect(email?.subject).toMatch(/approved/i)
    expect(email?.text).toContain('Nova')
  })

  it('lets a declined applicant submit again while keeping the decision history', async () => {
    const adminId = await createAdmin()
    const userId = await signInWithGoogle(googleClaims())

    await submitApplication({
      userId,
      data: { firstName: 'Nova', lastName: 'Hart', discordHandle: 'nova.hart' },
    })

    const [pending] = await listApplications('pending')
    await decideApplication({
      actorId: adminId,
      applicationId: pending!.id,
      decision: 'declined',
      decisionNote: 'Please use your school Discord handle.',
    })

    expect((await loadViewer(userId))?.status).toBe('pending')

    await submitApplication({
      userId,
      data: { firstName: 'Nova', lastName: 'Hart', discordHandle: 'nova.school' },
    })

    const all = await listApplications()
    expect(all).toHaveLength(2)
    expect(all.filter((entry) => entry.status === 'declined')).toHaveLength(1)
    expect(all.filter((entry) => entry.status === 'pending')).toHaveLength(1)
  })

  it('refuses to decide the same registration twice', async () => {
    const adminId = await createAdmin()
    const userId = await signInWithGoogle(googleClaims())
    await submitApplication({
      userId,
      data: { firstName: 'Nova', lastName: 'Hart', discordHandle: 'nova.hart' },
    })

    const [pending] = await listApplications('pending')
    await decideApplication({
      actorId: adminId,
      applicationId: pending!.id,
      decision: 'approved',
    })

    await expect(
      decideApplication({
        actorId: adminId,
        applicationId: pending!.id,
        decision: 'declined',
      }),
    ).rejects.toThrow(/already been decided/i)
  })
})

describe('volunteer hour requests', () => {
  it('refuses a submission from a member who is not approved', async () => {
    const userId = await signInWithGoogle(googleClaims())

    await expect(submitHours(userId)).rejects.toThrow(/approved members/i)
    expect(harness.storage.size).toBe(0)
  })

  it('stores the request with its evidence photos', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId, { photos: 3 })

    const request = await getRequest(requestId)
    expect(request?.status).toBe('pending')
    expect(request?.minutes).toBe(150)
    expect(request?.attachments).toHaveLength(3)
    expect(harness.storage.size).toBe(3)

    for (const attachment of request!.attachments) {
      expect(attachment.contentType).toBe('image/png')
    }
  })

  it('rejects more than five photos and leaves nothing stored', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)

    await expect(submitHours(memberId, { photos: 6 })).rejects.toThrow(/at most 5/i)
    expect(harness.storage.size).toBe(0)
  })

  it('rejects a non-image attachment', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)

    await expect(
      createRequest({
        userId: memberId,
        data: {
          serviceDate: '2026-06-10',
          activity: 'Ran the registration desk at the food drive',
          hours: 2,
        },
        files: [
          {
            fileName: 'evil.html',
            contentType: 'text/html',
            bytes: Buffer.from('<script>'),
          },
        ],
      }),
    ).rejects.toThrow(/JPEG, PNG, WebP or HEIC/i)
  })

  it('flags another submission for the same member and date', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)

    const first = await submitHours(memberId, { serviceDate: '2026-06-10' })
    const second = await submitHours(memberId, { serviceDate: '2026-06-10' })

    const duplicates = await findPotentialDuplicates({
      userId: memberId,
      serviceDate: '2026-06-10',
      excludeRequestId: second,
    })

    expect(duplicates.map((entry) => entry.id)).toContain(first)
  })
})

describe('review and awarding', () => {
  it('awards hours, issues a certificate and emails the member', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId, { hours: 2.5 })
    harness.emails.length = 0

    await reviewRequest({
      actorId: adminId,
      requestId,
      decision: 'approved',
    })

    expect(await totalMinutesForUser(harness.db, memberId)).toBe(150)

    const ledger = await listLedgerForUser(memberId)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.kind).toBe('award')
    expect(ledger[0]!.verificationId).toMatch(/^VH-/)

    const email = harness.emails.at(-1)!
    expect(email.subject).toContain('2.5')
    expect(email.text).toContain('show this to your school')
    expect(email.text).toContain(ledger[0]!.verificationId!)
  })

  it('never awards the same request twice', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId)

    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })
    await expect(
      reviewRequest({ actorId: adminId, requestId, decision: 'approved' }),
    ).rejects.toThrow(/already been awarded/i)

    expect(await totalMinutesForUser(harness.db, memberId)).toBe(150)
  })

  it('lets a reviewer award fewer hours than requested', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId, { hours: 4 })

    await reviewRequest({
      actorId: adminId,
      requestId,
      decision: 'approved',
      approvedHours: 3,
      reviewNote: 'Setup time is not counted.',
    })

    expect(await totalMinutesForUser(harness.db, memberId)).toBe(180)

    const request = await getRequest(requestId)
    expect(request?.minutes).toBe(240)
    expect(request?.awardedMinutes).toBe(180)
  })

  it('refuses to let an administrator review their own submission', async () => {
    const adminId = await createAdmin()
    const requestId = await submitHours(adminId)

    await expect(
      reviewRequest({ actorId: adminId, requestId, decision: 'approved' }),
    ).rejects.toThrow(/your own/i)
  })

  it('returns a request for changes and accepts a resubmission', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId, { photos: 1 })

    await reviewRequest({
      actorId: adminId,
      requestId,
      decision: 'changes_requested',
      reviewNote: 'Please attach a photo that shows the date.',
    })

    expect((await getRequest(requestId))?.status).toBe('changes_requested')
    expect(harness.emails.at(-1)?.text).toContain('shows the date')
    expect(await totalMinutesForUser(harness.db, memberId)).toBe(0)

    await updateRequest({
      userId: memberId,
      requestId,
      data: {
        serviceDate: '2026-06-10',
        activity: 'Ran the registration desk at the food drive, with a dated photo',
        hours: 2.5,
      },
      files: [
        { fileName: 'dated.png', contentType: 'image/png', bytes: PIXEL_PNG },
      ],
      removeAttachmentIds: [],
    })

    const updated = await getRequest(requestId)
    expect(updated?.status).toBe('pending')
    expect(updated?.reviewNote).toBeNull()
    expect(updated?.attachments).toHaveLength(2)
  })

  it('stops a member editing a request that is already decided', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId)

    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })

    await expect(
      updateRequest({
        userId: memberId,
        requestId,
        data: {
          serviceDate: '2026-06-10',
          activity: 'Trying to change an awarded entry',
          hours: 10,
        },
        files: [],
        removeAttachmentIds: [],
      }),
    ).rejects.toThrow(/can no longer be edited/i)
  })

  it('stops one member editing another member request', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const otherId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId)

    await expect(
      updateRequest({
        userId: otherId,
        requestId,
        data: {
          serviceDate: '2026-06-10',
          activity: 'Editing somebody else submission',
          hours: 1,
        },
        files: [],
        removeAttachmentIds: [],
      }),
    ).rejects.toThrow()
  })
})

describe('hour ledger corrections', () => {
  it('posts a correction as a new entry without rewriting the award', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId, { hours: 3 })
    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })

    await createAdjustment({
      actorId: adminId,
      userId: memberId,
      hours: -1,
      reason: 'Duplicate of the June 10 entry',
    })

    expect(await totalMinutesForUser(harness.db, memberId)).toBe(120)

    const ledger = await listLedgerForUser(memberId)
    expect(ledger).toHaveLength(2)

    const award = ledger.find((entry) => entry.kind === 'award')!
    expect(award.minutes).toBe(180)

    const adjustment = ledger.find((entry) => entry.kind === 'adjustment')!
    expect(adjustment.minutes).toBe(-60)
    expect(adjustment.reason).toBe('Duplicate of the June 10 entry')

    expect(harness.emails.at(-1)?.text).toContain('Duplicate of the June 10 entry')
  })
})

describe('certificates and public verification', () => {
  it('verifies an award certificate and reflects later corrections', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId, { firstName: 'Nova' })
    const requestId = await submitHours(memberId, { hours: 2 })
    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })

    const ledger = await listLedgerForUser(memberId)
    const verificationId = ledger[0]!.verificationId!

    const verified = await getCertificateByVerificationId(verificationId)
    expect(verified?.memberName).toBe('Nova Hart')
    expect(verified?.totalMinutes).toBe(120)
    expect(verified?.currentTotalMinutes).toBe(120)

    await createAdjustment({
      actorId: adminId,
      userId: memberId,
      hours: -0.5,
      reason: 'Corrected after checking the sign-in sheet',
    })

    const recheck = await getCertificateByVerificationId(verificationId)
    expect(recheck?.totalMinutes).toBe(120)
    expect(recheck?.currentTotalMinutes).toBe(90)
  })

  it('is case insensitive and returns nothing for an unknown id', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId)
    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })

    const ledger = await listLedgerForUser(memberId)
    const verificationId = ledger[0]!.verificationId!

    expect(
      await getCertificateByVerificationId(verificationId.toLowerCase()),
    ).not.toBeNull()
    expect(await getCertificateByVerificationId('VH-XXXXX-XXXXX')).toBeNull()
  })

  it('issues a summary certificate covering the whole record', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)

    const first = await submitHours(memberId, { serviceDate: '2026-05-02', hours: 2 })
    const second = await submitHours(memberId, { serviceDate: '2026-06-10', hours: 1.5 })
    await reviewRequest({ actorId: adminId, requestId: first, decision: 'approved' })
    await reviewRequest({ actorId: adminId, requestId: second, decision: 'approved' })

    const certificate = await issueSummaryCertificate(memberId)
    expect(certificate.totalMinutes).toBe(210)
    expect(certificate.periodStart).toBe('2026-05-02')
    expect(certificate.periodEnd).toBe('2026-06-10')

    const verified = await getCertificateByVerificationId(certificate.verificationId)
    expect(verified?.scope).toBe('summary')
  })
})

describe('membership status and roles', () => {
  it('suspending a member revokes their live sessions', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const token = await createSession(memberId)

    expect(await findSessionUserId(token)).toBe(memberId)

    await setMemberStatus({ actorId: adminId, userId: memberId, status: 'suspended' })

    expect(await findSessionUserId(token)).toBeNull()
    expect((await loadViewer(memberId))?.status).toBe('suspended')
  })

  it('preserves the hour record of a suspended member', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId)
    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })

    await setMemberStatus({ actorId: adminId, userId: memberId, status: 'suspended' })

    expect(await totalMinutesForUser(harness.db, memberId)).toBe(150)
    expect(await listLedgerForUser(memberId)).toHaveLength(1)
  })

  it('refuses to suspend the only administrator', async () => {
    const adminId = await createAdmin()

    await expect(
      setMemberStatus({ actorId: adminId, userId: adminId, status: 'suspended' }),
    ).rejects.toThrow(/without an administrator/i)

    expect((await loadViewer(adminId))?.status).toBe('approved')
  })

  it('refuses to strip the last administrator of role management', async () => {
    const adminId = await createAdmin()
    const adminRole = await requireRoleByKey(harness.db, SYSTEM_ROLE_KEYS.admin)

    await expect(
      updateRole({
        actorId: adminId,
        roleId: adminRole.id,
        name: 'Administrator',
        permissions: ['members.view'],
      }),
    ).rejects.toThrow(/without an administrator/i)

    const viewer = await loadViewer(adminId)
    expect(viewer?.permissions).toContain('roles.manage')
  })

  it('allows demoting an administrator while another one remains', async () => {
    const firstAdmin = await createAdmin('admin1@example.org')
    const secondAdmin = await createAdmin('admin2@example.org')
    const memberRole = await requireRoleByKey(harness.db, SYSTEM_ROLE_KEYS.member)

    await assignRole({
      actorId: firstAdmin,
      userId: secondAdmin,
      roleId: memberRole.id,
    })

    expect((await loadViewer(secondAdmin))?.role.key).toBe(SYSTEM_ROLE_KEYS.member)
    expect((await loadViewer(firstAdmin))?.role.key).toBe(SYSTEM_ROLE_KEYS.admin)
  })

  it('ends the sessions of anyone whose role changes', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const token = await createSession(memberId)

    const roles = await listRoles()
    const reviewerRoleId = await createRole({
      actorId: adminId,
      key: 'reviewer',
      name: 'Reviewer',
      permissions: ['requests.view_all', 'requests.review'],
    })

    expect(roles.length).toBeGreaterThan(0)

    await assignRole({ actorId: adminId, userId: memberId, roleId: reviewerRoleId })

    expect(await findSessionUserId(token)).toBeNull()
    expect((await loadViewer(memberId))?.permissions).toContain('requests.review')
  })

  it('creates a custom role with only the capabilities selected', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)

    const roleId = await createRole({
      actorId: adminId,
      key: 'coordinator',
      name: 'Coordinator',
      permissions: ['requests.view_all', 'members.view'],
    })
    await assignRole({ actorId: adminId, userId: memberId, roleId })

    const viewer = await loadViewer(memberId)
    expect(viewer?.permissions.sort()).toEqual(['members.view', 'requests.view_all'])
    expect(viewer?.permissions).not.toContain('requests.review')
    expect(viewer?.permissions).not.toContain('roles.manage')
  })

  it('seeds the built-in roles exactly once', async () => {
    await ensureSystemRoles(harness.db)
    await ensureSystemRoles(harness.db)

    const roles = await harness.db.select().from(schema.roles)
    expect(roles.filter((role) => role.key === SYSTEM_ROLE_KEYS.admin)).toHaveLength(1)
    expect(roles.filter((role) => role.key === SYSTEM_ROLE_KEYS.member)).toHaveLength(1)
  })
})

describe('directory and audit trail', () => {
  it('finds members by name, email and Discord handle', async () => {
    const adminId = await createAdmin()
    await createApprovedMember(adminId, {
      email: 'nova@gmail.com',
      firstName: 'Nova',
    })

    expect(await listMembers({ search: 'Nova' })).toHaveLength(1)
    expect(await listMembers({ search: 'nova@gmail' })).toHaveLength(1)
    expect(await listMembers({ search: 'nova.hart' })).toHaveLength(1)
    expect(await listMembers({ search: 'nobody' })).toHaveLength(0)
  })

  it('reports each member running hour total in the directory', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId, { hours: 2 })
    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })

    const members = await listMembers({ status: 'approved' })
    expect(members.find((member) => member.id === memberId)?.totalMinutes).toBe(120)
    expect(members.find((member) => member.id === adminId)?.totalMinutes).toBe(0)
  })

  it('records who approved hours and who corrected them', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId)
    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })
    await createAdjustment({
      actorId: adminId,
      userId: memberId,
      hours: -0.5,
      reason: 'Corrected after checking the sign-in sheet',
    })

    const actions = (await listAuditEvents()).map((event) => event.action)
    expect(actions).toContain('request.approved')
    expect(actions).toContain('hours.adjusted')
    expect(actions).toContain('application.approved')
    expect(actions).toContain('request.submitted')
  })
})

describe('notification delivery', () => {
  it('records a delivery failure without rolling back the award', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId)

    harness.failNextEmail()
    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })

    expect(await totalMinutesForUser(harness.db, memberId)).toBe(150)

    const notifications = await harness.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.type, 'request.approved'))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.status).toBe('failed')
    expect(notifications[0]!.error).toContain('Simulated provider outage')
    expect(notifications[0]!.attempts).toBe(1)
  })

  it('marks a delivered notification as sent with its provider id', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const requestId = await submitHours(memberId)

    await reviewRequest({ actorId: adminId, requestId, decision: 'approved' })

    const notifications = await harness.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.type, 'request.approved'))

    expect(notifications[0]!.status).toBe('sent')
    expect(notifications[0]!.providerMessageId).toMatch(/^test-/)
    expect(notifications[0]!.sentAt).not.toBeNull()
  })
})

describe('member view of their own record', () => {
  it('returns only the requesting member submissions', async () => {
    const adminId = await createAdmin()
    const memberId = await createApprovedMember(adminId)
    const otherId = await createApprovedMember(adminId)

    await submitHours(memberId)
    await submitHours(otherId)

    const mine = await listRequestsForUser(memberId)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.userId).toBe(memberId)
  })
})
