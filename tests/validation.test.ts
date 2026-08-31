import { describe, expect, it } from 'vitest'
import { formatHours, hoursToMinutes, minutesToHours, totalMinutes } from '~/lib/hours'
import {
  adjustmentSchema,
  applicationInputSchema,
  attachmentMetaSchema,
  isAllowedImageType,
  requestInputSchema,
  roleInputSchema,
} from '~/lib/validation'

describe('hour arithmetic', () => {
  it('stores hours as exact whole minutes', () => {
    expect(hoursToMinutes(2.5)).toBe(150)
    expect(hoursToMinutes(0.25)).toBe(15)
    expect(hoursToMinutes(1)).toBe(60)
  })

  it('rejects hours that do not land on a whole minute', () => {
    expect(() => hoursToMinutes(0.001)).toThrow()
    expect(() => hoursToMinutes(Number.NaN)).toThrow()
  })

  it('sums a ledger without floating point drift', () => {
    const entries = Array.from({ length: 10 }, () => ({ minutes: 10 }))
    expect(totalMinutes(entries)).toBe(100)
    expect(minutesToHours(totalMinutes(entries))).toBeCloseTo(1.6667, 4)
  })

  it('handles negative adjustments in a total', () => {
    expect(totalMinutes([{ minutes: 150 }, { minutes: -30 }])).toBe(120)
  })

  it('formats hours for display', () => {
    expect(formatHours(150)).toBe('2.5')
    expect(formatHours(120)).toBe('2')
    expect(formatHours(0)).toBe('0')
  })
})

describe('registration input', () => {
  it('accepts and trims a complete registration', () => {
    const result = applicationInputSchema.parse({
      firstName: '  Nova ',
      lastName: 'Hart',
      discordHandle: '@nova.hart',
      phone: '(555) 010-1234',
    })

    expect(result.firstName).toBe('Nova')
    expect(result.discordHandle).toBe('nova.hart')
  })

  it('accepts a legacy Discord handle with a discriminator', () => {
    const result = applicationInputSchema.parse({
      firstName: 'Ada',
      lastName: 'Byron',
      discordHandle: 'ada#1234',
    })
    expect(result.discordHandle).toBe('ada#1234')
  })

  it('rejects an empty name and a malformed handle', () => {
    expect(
      applicationInputSchema.safeParse({
        firstName: '   ',
        lastName: 'Hart',
        discordHandle: 'nova.hart',
      }).success,
    ).toBe(false)

    expect(
      applicationInputSchema.safeParse({
        firstName: 'Nova',
        lastName: 'Hart',
        discordHandle: 'nova hart!',
      }).success,
    ).toBe(false)
  })

  it('treats the phone number as optional', () => {
    expect(
      applicationInputSchema.safeParse({
        firstName: 'Nova',
        lastName: 'Hart',
        discordHandle: 'nova.hart',
      }).success,
    ).toBe(true)
  })
})

describe('volunteer request input', () => {
  const today = new Date('2026-06-15T12:00:00Z')
  const schema = requestInputSchema(today)

  const base = {
    serviceDate: '2026-06-10',
    activity: 'Ran the registration desk at the food drive',
    hours: 2.5,
  }

  it('accepts a well formed request', () => {
    expect(schema.parse(base).hours).toBe(2.5)
  })

  it('rejects a service date in the future', () => {
    const result = schema.safeParse({ ...base, serviceDate: '2026-06-16' })
    expect(result.success).toBe(false)
  })

  it('accepts today as a service date', () => {
    expect(schema.safeParse({ ...base, serviceDate: '2026-06-15' }).success).toBe(true)
  })

  it('rejects zero, negative and oversized hour values', () => {
    expect(schema.safeParse({ ...base, hours: 0 }).success).toBe(false)
    expect(schema.safeParse({ ...base, hours: -3 }).success).toBe(false)
    expect(schema.safeParse({ ...base, hours: 25 }).success).toBe(false)
  })

  it('rejects an activity that is too short to review', () => {
    expect(schema.safeParse({ ...base, activity: 'help' }).success).toBe(false)
  })
})

describe('attachment rules', () => {
  it('accepts the supported image types only', () => {
    expect(isAllowedImageType('image/jpeg')).toBe(true)
    expect(isAllowedImageType('image/png')).toBe(true)
    expect(isAllowedImageType('application/pdf')).toBe(false)
    expect(isAllowedImageType('text/html')).toBe(false)
  })

  it('rejects an oversized photo', () => {
    const result = attachmentMetaSchema.safeParse({
      fileName: 'proof.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 9 * 1024 * 1024,
    })
    expect(result.success).toBe(false)
  })
})

describe('adjustment input', () => {
  it('requires a reason and a non-zero amount', () => {
    expect(
      adjustmentSchema.safeParse({
        userId: '00000000-0000-4000-8000-000000000000',
        hours: 0,
        reason: 'Correcting a mistake',
      }).success,
    ).toBe(false)

    expect(
      adjustmentSchema.safeParse({
        userId: '00000000-0000-4000-8000-000000000000',
        hours: -1,
        reason: 'no',
      }).success,
    ).toBe(false)
  })

  it('accepts a negative correction with a reason', () => {
    const result = adjustmentSchema.safeParse({
      userId: '00000000-0000-4000-8000-000000000000',
      hours: -1.5,
      reason: 'Duplicate of the June 10 entry',
    })
    expect(result.success).toBe(true)
  })
})

describe('role input', () => {
  it('rejects unknown permissions', () => {
    const result = roleInputSchema.safeParse({
      key: 'coordinator',
      name: 'Coordinator',
      permissions: ['requests.review', 'not.a.real.permission'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a key that is not a lowercase identifier', () => {
    expect(
      roleInputSchema.safeParse({
        key: 'Coordinator Role',
        name: 'Coordinator',
        permissions: [],
      }).success,
    ).toBe(false)
  })
})
