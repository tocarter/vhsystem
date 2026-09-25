import { del, get, put } from '@vercel/blob'
import { assertSafeKey, type StorageDriver, type StoredFile } from './index'

/**
 * Vercel Blob (private access) for evidence photos. Reads and writes require
 * authentication — there is no publicly guessable URL — so this keeps the
 * same "only through the authorized route" guarantee as the S3 driver, but
 * needs no external account: the store is provisioned on the Vercel project
 * itself and authenticates via OIDC (falling back to `BLOB_READ_WRITE_TOKEN`
 * outside Vercel).
 */
export function createVercelBlobDriver(): StorageDriver {
  return {
    name: 'vercel-blob',

    async put(key, body, contentType) {
      assertSafeKey(key)
      await put(key, body, {
        access: 'private',
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      })
    },

    async get(key): Promise<StoredFile | null> {
      assertSafeKey(key)
      const result = await get(key, { access: 'private' }).catch((error) => {
        // The SDK throws for a missing object rather than returning null.
        if ((error as { name?: string }).name === 'BlobNotFoundError') return null
        throw error
      })
      if (!result || !result.stream) return null

      const chunks: Array<Buffer> = []
      for await (const chunk of result.stream as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk))
      }
      return {
        body: Buffer.concat(chunks),
        contentType: result.blob.contentType || 'application/octet-stream',
      }
    },

    async remove(key) {
      assertSafeKey(key)
      await del(key).catch((error) => {
        if ((error as { name?: string }).name === 'BlobNotFoundError') return
        throw error
      })
    },
  }
}
