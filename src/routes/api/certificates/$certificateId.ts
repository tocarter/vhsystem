import { createFileRoute } from '@tanstack/react-router'
import { canViewMemberRecords } from '~/lib/permissions'
import { displayName } from '~/lib/viewer'
import { getViewerForRequest, toPermissionViewer } from '~/server/auth/viewer'
import { appOrigin, organization } from '~/server/env'
import { getCertificateById } from '~/server/services/hours'
import { getMember } from '~/server/services/members'
import { renderCertificatePdf } from '~/server/pdf/certificate'
import { getDb, schema } from '~/server/db'
import { eq } from 'drizzle-orm'

const deny = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' },
  })

export const Route = createFileRoute('/api/certificates/$certificateId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const viewer = await getViewerForRequest(request)
        if (!viewer) return deny(401, 'Sign in to download this certificate.')

        const certificate = await getCertificateById(params.certificateId)
        if (!certificate) return deny(404, 'That certificate does not exist.')

        if (
          !canViewMemberRecords(toPermissionViewer(viewer), certificate.userId)
        ) {
          return deny(403, 'You do not have access to that certificate.')
        }

        const member = await getMember(certificate.userId)
        if (!member) return deny(404, 'That member no longer exists.')

        let activity: string | null = null
        if (certificate.scope === 'award' && certificate.awardId) {
          const rows = await (await getDb())
            .select({ activity: schema.volunteerRequests.activity })
            .from(schema.hourLedger)
            .innerJoin(
              schema.volunteerRequests,
              eq(schema.hourLedger.requestId, schema.volunteerRequests.id),
            )
            .where(eq(schema.hourLedger.id, certificate.awardId))
            .limit(1)
          activity = rows[0]?.activity ?? null
        }

        const org = organization()
        const pdf = await renderCertificatePdf({
          orgName: org.name,
          orgContactEmail: org.contactEmail,
          memberName: displayName({
            firstName: member.firstName,
            lastName: member.lastName,
            email: member.email,
          }),
          scope: certificate.scope,
          totalMinutes: certificate.totalMinutes,
          periodStart: certificate.periodStart,
          periodEnd: certificate.periodEnd,
          activity,
          verificationId: certificate.verificationId,
          verifyUrl: `${appOrigin()}/verify/${certificate.verificationId}`,
          issuedAt: certificate.issuedAt,
          issuedByName: org.contactName || org.name,
        })

        return new Response(new Uint8Array(pdf), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(pdf.byteLength),
            'Content-Disposition': `attachment; filename="volunteer-hours-${certificate.verificationId}.pdf"`,
            'Cache-Control': 'private, no-store',
          },
        })
      },
    },
  },
})
