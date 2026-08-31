import fs from 'node:fs/promises'
import path from 'node:path'
import { readEnv } from '../env'
import { assertSafeKey, type StorageDriver, type StoredFile } from './index'

const META_SUFFIX = '.meta.json'

/**
 * Filesystem-backed storage for local development. Files live outside the
 * served asset directories, so they are only reachable through the authorized
 * download route.
 */
export function createLocalDriver(): StorageDriver {
  const root = path.resolve(readEnv('LOCAL_STORAGE_DIR') ?? '.data/uploads')

  const resolve = (key: string) => {
    assertSafeKey(key)
    const full = path.resolve(root, key)
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Unsafe storage key: ${key}`)
    }
    return full
  }

  return {
    name: 'local',

    async put(key, body, contentType) {
      const full = resolve(key)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, body)
      await fs.writeFile(`${full}${META_SUFFIX}`, JSON.stringify({ contentType }))
    },

    async get(key): Promise<StoredFile | null> {
      const full = resolve(key)
      try {
        const body = await fs.readFile(full)
        let contentType = 'application/octet-stream'
        try {
          const meta = JSON.parse(
            await fs.readFile(`${full}${META_SUFFIX}`, 'utf8'),
          ) as { contentType?: string }
          if (meta.contentType) contentType = meta.contentType
        } catch {
          // Metadata is best effort; the database row is the source of truth.
        }
        return { body, contentType }
      } catch {
        return null
      }
    },

    async remove(key) {
      const full = resolve(key)
      await fs.rm(full, { force: true })
      await fs.rm(`${full}${META_SUFFIX}`, { force: true })
    },
  }
}
