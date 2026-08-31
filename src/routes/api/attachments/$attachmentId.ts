import { createFileRoute } from '@tanstack/react-router'
import { canViewMemberRecords } from '~/lib/permissions'
import { getViewerForRequest, toPermissionViewer } from '~/server/auth/viewer'
import { readAttachmentToken } from '~/server/functions/attachments'
import { getAttachment } from '~/server/services/requests'
import { getStorage } from '~/server/storage'

const deny = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' },
  })

export const Route = createFileRoute('/api/attachments/$attachmentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url)
        const token = url.searchParams.get('token')
        if (!token) return deny(400, 'A download token is required.')

        const payload = readAttachmentToken(token)
        if (!payload) return deny(403, 'This download link has expired.')
        if (payload.attachmentId !== params.attachmentId) {
          return deny(403, 'This download link is not valid for that file.')
        }

        // The token alone is never enough: the caller must still hold a live
        // session for the member the link was issued to.
        const viewer = await getViewerForRequest(request)
        if (!viewer) return deny(401, 'Sign in to view this photo.')
        if (viewer.id !== payload.viewerId) {
          return deny(403, 'This download link was issued to someone else.')
        }

        const record = await getAttachment(params.attachmentId)
        if (!record) return deny(404, 'That photo no longer exists.')

        if (
          !canViewMemberRecords(toPermissionViewer(viewer), record.requestUserId)
        ) {
          return deny(403, 'You do not have access to that photo.')
        }

        const file = await getStorage().get(record.attachment.storageKey)
        if (!file) return deny(404, 'That photo is no longer stored.')

        return new Response(new Uint8Array(file.body), {
          status: 200,
          headers: {
            'Content-Type': record.attachment.contentType,
            'Content-Length': String(file.body.byteLength),
            'Content-Disposition': `inline; filename="${encodeURIComponent(record.attachment.fileName)}"`,
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
          },
        })
      },
    },
  },
})
