import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { canViewMemberRecords } from '~/lib/permissions'
import { loadViewer, toPermissionViewer } from '~/server/auth/viewer'
import {
  attachmentToken,
  readAttachmentToken,
} from '~/server/functions/attachments'
import {
  decideApplication,
  listApplications,
  signInWithGoogle,
  submitApplication,
} from '~/server/services/members'
import {
  createRequest,
  getAttachment,
  getRequest,
} from '~/server/services/requests'
import { assignRole, createRole } from '~/server/services/roles'
import { createHarness, googleClaims, PIXEL_PNG, type Harness } from './helpers/harness'

let harness: Harness

beforeAll(async () => {
  harness = await createHarness()
  process.env.SESSION_SECRET = 'authorization-test-secret'
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
  const id = await signInWithGoogle(googleClaims({ email }))
  delete process.env.BOOTSTRAP_ADMIN_EMAILS
  return id
}

async function createApprovedMember(adminId: string) {
  const userId = await signInWithGoogle(googleClaims())
  await submitApplication({
    userId,
    data: { firstName: 'Nova', lastName: 'Hart', discordHandle: 'nova.hart' },
  })
  const [application] = await listApplications('pending')
  await decideApplication({
    actorId: adminId,
    applicationId: application!.id,
    decision: 'approved',
  })
  return userId
}

describe('evidence photo access', () => {
  it('lets the owner and a reviewer through, but not another member', async () => {
    const adminId = await createAdmin()
    const ownerId = await createApprovedMember(adminId)
    const otherId = await createApprovedMember(adminId)

    const requestId = await createRequest({
      userId: ownerId,
      data: {
        serviceDate: '2026-06-10',
        activity: 'Ran the registration desk at the food drive',
        hours: 2,
      },
      files: [{ fileName: 'proof.png', contentType: 'image/png', bytes: PIXEL_PNG }],
    })

    const request = await getRequest(requestId)
    const attachmentId = request!.attachments[0]!.id
    const record = await getAttachment(attachmentId)
    expect(record?.requestUserId).toBe(ownerId)

    const owner = toPermissionViewer((await loadViewer(ownerId))!)
    const other = toPermissionViewer((await loadViewer(otherId))!)
    const admin = toPermissionViewer((await loadViewer(adminId))!)

    expect(canViewMemberRecords(owner, record!.requestUserId)).toBe(true)
    expect(canViewMemberRecords(admin, record!.requestUserId)).toBe(true)
    expect(canViewMemberRecords(other, record!.requestUserId)).toBe(false)
  })

  it('binds a download token to the viewer it was issued for', async () => {
    const token = attachmentToken('attachment-1', 'viewer-1')
    const payload = readAttachmentToken(token)

    expect(payload).toEqual({ attachmentId: 'attachment-1', viewerId: 'viewer-1' })
    // The route rejects when the live session is a different member.
    expect(payload!.viewerId).not.toBe('viewer-2')
  })

  it('stops a suspended reviewer from reading member evidence', async () => {
    const adminId = await createAdmin()
    const ownerId = await createApprovedMember(adminId)

    const reviewerId = await createApprovedMember(adminId)
    const reviewerRole = await createRole({
      actorId: adminId,
      key: 'reviewer',
      name: 'Reviewer',
      permissions: ['requests.view_all', 'requests.review'],
    })
    await assignRole({ actorId: adminId, userId: reviewerId, roleId: reviewerRole })

    const active = toPermissionViewer((await loadViewer(reviewerId))!)
    expect(canViewMemberRecords(active, ownerId)).toBe(true)

    const suspended = { ...active, status: 'suspended' as const }
    expect(canViewMemberRecords(suspended, ownerId)).toBe(false)
  })
})

/**
 * Route guards are UX. These checks assert the data boundary itself: every
 * server function either composes an authorization middleware or is explicitly
 * listed as public.
 */
describe('server function protection', () => {
  const PUBLIC_FUNCTIONS = new Set([
    // Returns the caller's own session, or null. Nothing else is disclosed.
    'fetchSessionUser',
    // Ends the caller's own session.
    'signOut',
    // Certificate lookup by unguessable id, for schools without an account.
    'verifyCertificate',
  ])

  const AUTH_MIDDLEWARE = [
    'authedMiddleware',
    'approvedMiddleware',
    'permissionMiddleware',
  ]

  it('guards every server function that is not deliberately public', async () => {
    const directory = path.resolve('src/server/functions')
    const files = (await fs.readdir(directory)).filter((file) =>
      file.endsWith('.ts'),
    )

    const unguarded: Array<string> = []
    let examined = 0

    for (const file of files) {
      const source = await fs.readFile(path.join(directory, file), 'utf8')

      // Each declaration runs from `export const name = createServerFn` to the
      // start of the next top-level export.
      const declarations = source.split(/\nexport const /).slice(1)

      for (const declaration of declarations) {
        const name = declaration.slice(0, declaration.indexOf(' '))
        if (!declaration.includes('createServerFn')) continue
        if (PUBLIC_FUNCTIONS.has(name)) continue

        examined += 1
        const guarded = AUTH_MIDDLEWARE.some((middleware) =>
          declaration.includes(middleware),
        )
        if (!guarded) unguarded.push(`${file}:${name}`)
      }
    }

    expect(unguarded).toEqual([])
    // Guards against the parser silently matching nothing.
    expect(examined).toBeGreaterThanOrEqual(10)
  })

  it('covers every server function file in the check', async () => {
    const directory = path.resolve('src/server/functions')
    const files = await fs.readdir(directory)

    expect(files).toContain('members.ts')
    expect(files).toContain('requests.ts')
    expect(files).toContain('hours.ts')
    expect(files).toContain('roles.ts')
    expect(files).toContain('verify.ts')
    expect(files).toContain('session.ts')
  })

  it('rate limits the endpoints an anonymous or new caller can reach', async () => {
    const directory = path.resolve('src/server/functions')

    const verify = await fs.readFile(path.join(directory, 'verify.ts'), 'utf8')
    expect(verify).toContain('rateLimitMiddleware')

    const members = await fs.readFile(path.join(directory, 'members.ts'), 'utf8')
    expect(members).toContain('rateLimitMiddleware')

    const requests = await fs.readFile(path.join(directory, 'requests.ts'), 'utf8')
    expect(requests).toContain('rateLimitMiddleware')
  })
})
