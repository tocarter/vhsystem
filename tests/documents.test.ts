import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderCertificatePdf } from '~/server/pdf/certificate'
import {
  applicationApprovedEmail,
  applicationDeclinedEmail,
  hoursAdjustedEmail,
  hoursApprovedEmail,
  requestDeclinedEmail,
} from '~/server/email/templates'

const brand = { orgName: 'Test Volunteer Team', appOrigin: 'https://hours.example.org' }

beforeAll(() => {
  process.env.SESSION_SECRET = 'documents-test-secret'
})

describe('certificate pdf', () => {
  const base = {
    orgName: 'Test Volunteer Team',
    orgContactEmail: 'team@example.org',
    memberName: 'Nova Hart',
    verificationId: 'VH-ABCDE-FGHJK',
    verifyUrl: 'https://hours.example.org/verify/VH-ABCDE-FGHJK',
    issuedAt: new Date('2026-06-20T10:00:00Z'),
    issuedByName: 'Test Volunteer Team',
  }

  it('renders a single-page PDF for one award', async () => {
    const bytes = await renderCertificatePdf({
      ...base,
      scope: 'award',
      totalMinutes: 150,
      periodStart: '2026-06-10',
      periodEnd: '2026-06-10',
      activity: 'Ran the registration desk at the food drive',
    })

    expect(bytes.byteLength).toBeGreaterThan(1000)
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')

    const parsed = await PDFDocument.load(bytes)
    expect(parsed.getPageCount()).toBe(1)
    expect(parsed.getTitle()).toContain('VH-ABCDE-FGHJK')
    expect(parsed.getAuthor()).toBe('Test Volunteer Team')
  })

  it('renders a summary certificate spanning a service period', async () => {
    const bytes = await renderCertificatePdf({
      ...base,
      scope: 'summary',
      totalMinutes: 1230,
      periodStart: '2026-01-04',
      periodEnd: '2026-06-10',
      activity: null,
    })

    const parsed = await PDFDocument.load(bytes)
    expect(parsed.getPageCount()).toBe(1)
  })

  it('survives a very long activity description without throwing', async () => {
    const bytes = await renderCertificatePdf({
      ...base,
      scope: 'award',
      totalMinutes: 60,
      periodStart: '2026-06-10',
      periodEnd: '2026-06-10',
      activity: 'Coordinated volunteers '.repeat(40),
    })

    expect(bytes.byteLength).toBeGreaterThan(1000)
  })

  it('renders when no service period is known', async () => {
    const bytes = await renderCertificatePdf({
      ...base,
      scope: 'summary',
      totalMinutes: 0,
      periodStart: null,
      periodEnd: null,
      activity: null,
    })

    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
  })
})

describe('email templates', () => {
  it('tells an approved member what they can show their school', () => {
    const email = hoursApprovedEmail({
      brand,
      memberName: 'Nova',
      minutes: 150,
      serviceDate: '2026-06-10',
      activity: 'Ran the registration desk',
      totalMinutes: 330,
      verificationId: 'VH-ABCDE-FGHJK',
    })

    expect(email.subject).toBe('2.5 volunteer hours approved')
    expect(email.text).toContain('Nova')
    expect(email.text).toContain('show this to your school')
    expect(email.text).toContain('VH-ABCDE-FGHJK')
    expect(email.text).toContain('5.5')
    expect(email.html).toContain('https://hours.example.org/verify/VH-ABCDE-FGHJK')
  })

  it('escapes member supplied content in the html body', () => {
    const email = hoursApprovedEmail({
      brand,
      memberName: '<script>alert(1)</script>',
      minutes: 60,
      serviceDate: '2026-06-10',
      activity: 'Tidied the "north" hall & garden',
      totalMinutes: 60,
      verificationId: 'VH-ABCDE-FGHJK',
    })

    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('&amp;')
    expect(email.html).toContain('&quot;north&quot;')
  })

  it('distinguishes a decline from a request for changes', () => {
    const declined = requestDeclinedEmail({
      brand,
      memberName: 'Nova',
      serviceDate: '2026-06-10',
      activity: 'Ran the registration desk',
      reviewNote: 'We could not match this to an event.',
      changesRequested: false,
    })
    const changes = requestDeclinedEmail({
      brand,
      memberName: 'Nova',
      serviceDate: '2026-06-10',
      activity: 'Ran the registration desk',
      reviewNote: 'Please attach a dated photo.',
      changesRequested: true,
    })

    expect(declined.subject).toMatch(/declined/i)
    expect(changes.subject).toMatch(/more detail/i)
    expect(changes.text).toContain('Please attach a dated photo.')
  })

  it('points a declined applicant back to the registration form', () => {
    const email = applicationDeclinedEmail({
      brand,
      memberName: 'Nova',
      decisionNote: 'Use your school Discord handle.',
    })

    expect(email.text).toContain('/register')
    expect(email.text).toContain('Use your school Discord handle.')
  })

  it('welcomes an approved applicant to the dashboard', () => {
    const email = applicationApprovedEmail({ brand, memberName: 'Nova' })
    expect(email.subject).toContain('Test Volunteer Team')
    expect(email.text).toContain('/dashboard')
  })

  it('states the direction and reason of a correction', () => {
    const removed = hoursAdjustedEmail({
      brand,
      memberName: 'Nova',
      minutes: -90,
      reason: 'Duplicate entry',
      totalMinutes: 60,
    })
    const added = hoursAdjustedEmail({
      brand,
      memberName: 'Nova',
      minutes: 30,
      reason: 'Missed travel time',
      totalMinutes: 90,
    })

    expect(removed.subject).toBe('1.5 volunteer hours removed from your record')
    expect(removed.text).toContain('-1.5 hours')
    expect(removed.text).toContain('Duplicate entry')

    expect(added.subject).toBe('0.5 volunteer hours added to your record')
    expect(added.text).toContain('+0.5 hours')
  })
})
