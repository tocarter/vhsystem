import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '~/server/db/schema'
import { setDatabaseForTesting, type Database } from '~/server/db'
import { setEmailDriverForTesting, type EmailDriver } from '~/server/email'
import { setStorageDriverForTesting, type StorageDriver } from '~/server/storage'

export type SentEmail = {
  to: string
  subject: string
  text: string
  html: string
}

export type Harness = {
  /** Presented as the app's database type; drizzle's driver types are invariant. */
  db: Database
  client: PGlite
  emails: Array<SentEmail>
  failNextEmail: () => void
  storage: Map<string, { body: Buffer; contentType: string }>
  reset: () => Promise<void>
  close: () => Promise<void>
}

/**
 * Real Postgres semantics in-process, so partial unique indexes, transactions
 * and `FOR UPDATE` behave exactly as they will in production.
 */
export async function createHarness(): Promise<Harness> {
  process.env.SESSION_SECRET ??= 'test-secret-value-for-signing-tokens'
  process.env.APP_ORIGIN ??= 'http://localhost:3000'
  process.env.ORG_NAME ??= 'Test Volunteer Team'
  process.env.ORG_CONTACT_EMAIL ??= 'team@example.org'
  process.env.EMAIL_DRIVER = 'console'

  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
  setDatabaseForTesting(db)

  const emails: Array<SentEmail> = []
  let failNext = false

  const emailDriver: EmailDriver = {
    name: 'test',
    async send(message) {
      if (failNext) {
        failNext = false
        throw new Error('Simulated provider outage')
      }
      emails.push(message)
      return { providerMessageId: `test-${emails.length}` }
    },
  }
  setEmailDriverForTesting(emailDriver)

  const storage = new Map<string, { body: Buffer; contentType: string }>()
  const storageDriver: StorageDriver = {
    name: 'memory',
    async put(key, body, contentType) {
      storage.set(key, { body, contentType })
    },
    async get(key) {
      return storage.get(key) ?? null
    },
    async remove(key) {
      storage.delete(key)
    },
  }
  setStorageDriverForTesting(storageDriver)

  return {
    db: db as unknown as Database,
    client,
    emails,
    failNextEmail: () => {
      failNext = true
    },
    storage,
    async reset() {
      await client.exec(`
        truncate table
          audit_events, notifications, certificates, hour_ledger,
          request_attachments, volunteer_requests, membership_applications,
          sessions, oauth_attempts, users, role_permissions, roles
        restart identity cascade;
      `)
      emails.length = 0
      storage.clear()
      failNext = false
    },
    async close() {
      setDatabaseForTesting(undefined)
      setEmailDriverForTesting(undefined)
      setStorageDriverForTesting(undefined)
      await client.close()
    },
  }
}

export function googleClaims(overrides: Partial<{
  sub: string
  email: string
  name: string
}> = {}) {
  return {
    sub: overrides.sub ?? `google-${Math.random().toString(36).slice(2)}`,
    email: overrides.email ?? `member-${Math.random().toString(36).slice(2)}@gmail.com`,
    emailVerified: true,
    name: overrides.name ?? 'Test Member',
    picture: undefined,
  }
}

export const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
