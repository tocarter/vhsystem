import { z } from 'zod'
import { MAX_HOURS_PER_REQUEST } from './hours'
import { ALL_PERMISSIONS, isPermission } from './permissions'

export const MAX_ATTACHMENTS = 5
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as ReadonlyArray<string>).includes(value)
}

const trimmed = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(min).max(max))

/**
 * Accepts both the modern Discord username (`someone`) and the legacy
 * discriminator form (`someone#1234`).
 */
export const discordHandleSchema = z
  .string()
  .transform((value) => value.trim().replace(/^@/, ''))
  .pipe(
    z
      .string()
      .min(2)
      .max(37)
      .regex(
        /^[a-zA-Z0-9._]{2,32}(#\d{4})?$/,
        'Use letters, numbers, periods or underscores',
      ),
  )

export const phoneSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(7)
      .max(20)
      .regex(/^[0-9+()\-.\s]+$/, 'Use digits and phone punctuation only'),
  )

export const applicationInputSchema = z.object({
  firstName: trimmed(1, 60),
  lastName: trimmed(1, 60),
  discordHandle: discordHandleSchema,
  phone: z.union([phoneSchema, z.literal('')]).optional(),
})

export type ApplicationInput = z.infer<typeof applicationInputSchema>

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'Not a real date',
  })

/**
 * Service dates are compared in UTC against the caller-supplied "today" so the
 * same rule can be exercised deterministically in tests.
 */
export function serviceDateSchema(today = new Date()) {
  const todayIso = today.toISOString().slice(0, 10)
  return isoDate
    .refine((value) => value <= todayIso, {
      message: 'Service date cannot be in the future',
    })
    .refine((value) => value >= '2000-01-01', {
      message: 'Service date is too far in the past',
    })
}

export const hoursSchema = z
  .number()
  .positive('Enter more than zero hours')
  .max(MAX_HOURS_PER_REQUEST, `A single entry cannot exceed ${MAX_HOURS_PER_REQUEST} hours`)
  .refine((value) => Math.abs(value * 60 - Math.round(value * 60)) < 1e-6, {
    message: 'Hours must land on a whole minute',
  })

/** Built per call so "today" is evaluated when the request arrives. */
export function requestInputSchema(today = new Date()) {
  return z.object({
    serviceDate: serviceDateSchema(today),
    activity: trimmed(5, 500),
    hours: hoursSchema,
    notes: z.union([z.string().max(2000), z.literal('')]).optional(),
  })
}

export type RequestInput = z.infer<ReturnType<typeof requestInputSchema>>

export const reviewDecisionSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(['approved', 'declined', 'changes_requested']),
  reviewNote: z.union([z.string().max(1000), z.literal('')]).optional(),
  /** Reviewers may award fewer hours than requested; omitted means "as requested". */
  approvedHours: hoursSchema.optional(),
})

export const applicationDecisionSchema = z.object({
  applicationId: z.uuid(),
  decision: z.enum(['approved', 'declined']),
  decisionNote: z.union([z.string().max(1000), z.literal('')]).optional(),
})

export const adjustmentSchema = z.object({
  userId: z.uuid(),
  hours: z
    .number()
    .refine((value) => value !== 0, 'An adjustment cannot be zero hours')
    .refine(
      (value) => Math.abs(value) <= MAX_HOURS_PER_REQUEST,
      `An adjustment cannot exceed ${MAX_HOURS_PER_REQUEST} hours`,
    )
    .refine((value) => Math.abs(value * 60 - Math.round(value * 60)) < 1e-6, {
      message: 'Hours must land on a whole minute',
    }),
  reason: trimmed(5, 500),
})

export const permissionSchema = z.string().refine(isPermission, {
  message: 'Unknown permission',
})

export const roleInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers and underscores'),
  name: trimmed(2, 60),
  description: z.union([z.string().max(200), z.literal('')]).optional(),
  permissions: z.array(permissionSchema).max(ALL_PERMISSIONS.length),
})

export const attachmentMetaSchema = z.object({
  fileName: trimmed(1, 200),
  contentType: z.string().refine(isAllowedImageType, {
    message: 'Only JPEG, PNG, WebP or HEIC images are accepted',
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_ATTACHMENT_BYTES, 'Each photo must be 8 MB or smaller'),
})
