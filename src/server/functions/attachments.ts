import { signPayload, verifyPayload } from '../tokens'

const ATTACHMENT_TTL_SECONDS = 15 * 60

export type AttachmentTokenPayload = {
  attachmentId: string
  viewerId: string
}

/**
 * Download links expire on their own, and are bound to the viewer they were
 * minted for. The download route still re-checks the session and permissions,
 * so a leaked link is not a capability by itself.
 */
export function attachmentToken(attachmentId: string, viewerId: string): string {
  return signPayload({ attachmentId, viewerId }, ATTACHMENT_TTL_SECONDS)
}

export function readAttachmentToken(
  token: string,
): AttachmentTokenPayload | null {
  const payload = verifyPayload<{ attachmentId: string; viewerId: string }>(token)
  if (!payload) return null
  if (
    typeof payload.attachmentId !== 'string' ||
    typeof payload.viewerId !== 'string'
  ) {
    return null
  }
  return { attachmentId: payload.attachmentId, viewerId: payload.viewerId }
}

export function attachmentUrl(attachmentId: string, viewerId: string): string {
  return `/api/attachments/${attachmentId}?token=${encodeURIComponent(
    attachmentToken(attachmentId, viewerId),
  )}`
}
