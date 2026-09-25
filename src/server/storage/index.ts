import crypto from 'node:crypto'
import { readEnv } from '../env'
import { createLocalDriver } from './local'
import { createS3Driver } from './s3'
import { createVercelBlobDriver } from './vercel-blob'

export type StoredFile = {
  body: Buffer
  contentType: string
}

export type StorageDriver = {
  readonly name: string
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<StoredFile | null>
  remove(key: string): Promise<void>
}

let cached: StorageDriver | undefined

export function setStorageDriverForTesting(driver: StorageDriver | undefined) {
  cached = driver
}

export function getStorage(): StorageDriver {
  if (cached) return cached
  const driver = readEnv('STORAGE_DRIVER')
  cached =
    driver === 's3'
      ? createS3Driver()
      : driver === 'vercel-blob'
        ? createVercelBlobDriver()
        : createLocalDriver()
  return cached
}

/**
 * Keys are server-generated and namespaced by request so an attacker cannot
 * influence the storage path, and never contain the original file name.
 */
export function buildAttachmentKey(requestId: string, contentType: string): string {
  const extension = extensionFor(contentType)
  return `requests/${requestId}/${crypto.randomUUID()}${extension}`
}

export function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/heic':
      return '.heic'
    default:
      return ''
  }
}

/** Rejects anything that could escape the storage root. */
export function assertSafeKey(key: string): void {
  if (
    key.length === 0 ||
    key.startsWith('/') ||
    key.includes('..') ||
    key.includes('\\') ||
    key.includes('\0')
  ) {
    throw new Error(`Unsafe storage key: ${key}`)
  }
}
