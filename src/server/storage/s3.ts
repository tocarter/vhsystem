import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { readEnv, requireEnv } from '../env'
import { assertSafeKey, type StorageDriver, type StoredFile } from './index'

/**
 * Works with any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2).
 * The bucket stays private: downloads are streamed through the app's authorized
 * route rather than handed out as direct object URLs.
 */
export function createS3Driver(): StorageDriver {
  const bucket = requireEnv('S3_BUCKET')
  const client = new S3Client({
    region: readEnv('S3_REGION') ?? 'auto',
    endpoint: readEnv('S3_ENDPOINT'),
    forcePathStyle: readEnv('S3_FORCE_PATH_STYLE') === 'true',
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
  })

  return {
    name: 's3',

    async put(key, body, contentType) {
      assertSafeKey(key)
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      )
    },

    async get(key): Promise<StoredFile | null> {
      assertSafeKey(key)
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        )
        if (!result.Body) return null
        const bytes = await result.Body.transformToByteArray()
        return {
          body: Buffer.from(bytes),
          contentType: result.ContentType ?? 'application/octet-stream',
        }
      } catch (error) {
        const name = (error as { name?: string }).name
        if (name === 'NoSuchKey' || name === 'NotFound') return null
        throw error
      }
    },

    async remove(key) {
      assertSafeKey(key)
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}
