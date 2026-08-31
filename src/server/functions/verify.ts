import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { organization } from '../env'
import { getCertificateByVerificationId } from '../services/hours'
import { rateLimitMiddleware } from './middleware'

export type VerificationResult =
  | { found: false }
  | {
      found: true
      orgName: string
      orgContactEmail: string
      memberName: string
      scope: 'award' | 'summary'
      totalMinutes: number
      currentTotalMinutes: number
      periodStart: string | null
      periodEnd: string | null
      activity: string | null
      issuedAt: Date
      membershipActive: boolean
    }

/**
 * Public on purpose: a school holding the printed certificate must be able to
 * confirm it without an account. Only what is already on the certificate is
 * disclosed, and the id is unguessable.
 */
export const verifyCertificate = createServerFn({ method: 'GET' })
  .middleware([
    rateLimitMiddleware({ key: 'verify', max: 60, windowMs: 60 * 60_000 }),
  ])
  .validator((data: unknown) =>
    z
      .object({
        verificationId: z.string().trim().min(4).max(40),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<VerificationResult> => {
    const certificate = await getCertificateByVerificationId(data.verificationId)
    if (!certificate) return { found: false }

    const org = organization()
    return {
      found: true,
      orgName: org.name,
      orgContactEmail: org.contactEmail,
      memberName: certificate.memberName,
      scope: certificate.scope,
      totalMinutes: certificate.totalMinutes,
      currentTotalMinutes: certificate.currentTotalMinutes,
      periodStart: certificate.periodStart,
      periodEnd: certificate.periodEnd,
      activity: certificate.activity,
      issuedAt: certificate.issuedAt,
      membershipActive: certificate.memberStatus === 'approved',
    }
  })
