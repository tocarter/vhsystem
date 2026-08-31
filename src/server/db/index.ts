import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { invalid } from '~/lib/errors'
import { readEnv } from '../env'

export type Database = PostgresJsDatabase<typeof schema>

export type Transaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0]

/** Lets services run either standalone or inside a caller's transaction. */
export type Executor = Database | Transaction

let cached: { db: Database; url: string } | undefined
let starting: Promise<Database> | undefined

/**
 * Tests swap in a PGlite-backed instance so the whole service layer runs
 * against real Postgres semantics without an external server.
 */
let override: Database | undefined

export function setDatabaseForTesting(db: unknown) {
  // Drizzle's driver-specific database types are invariant, so the PGlite
  // instance used by tests is adapted here rather than at every call site.
  override = (db ?? undefined) as Database | undefined
}

function isPgliteUrl(url: string | undefined): boolean {
  if (!url) return true
  return url.startsWith('pglite:') || url.startsWith('file:')
}

function pgliteDataDir(url: string | undefined): string {
  if (!url || url === 'pglite' || url === 'pglite:') return '.data/pglite'
  return url.replace(/^pglite:/, '').replace(/^file:/, '') || '.data/pglite'
}

async function openPglite(url: string | undefined): Promise<Database> {
  const [{ PGlite }, { drizzle }, { migrate }, { mkdir }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
    import('node:fs/promises'),
  ])
  const dataDir = pgliteDataDir(url)
  // PGlite's own mkdir does not create missing parent directories.
  await mkdir(dataDir, { recursive: true })
  const client = new PGlite(dataDir)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
  return db as unknown as Database
}

async function openPostgres(url: string): Promise<Database> {
  try {
    const client = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      prepare: false,
      idle_timeout: 20,
    })
    const db = drizzlePostgres(client, { schema })
    // Fail fast if nothing is listening, instead of on the first real query.
    await client`select 1`
    return db
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : ''
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      throw invalid(
        'Could not connect to Postgres. For local work set DATABASE_URL=pglite:.data/pglite, or start a Postgres server.',
      )
    }
    throw error
  }
}

/**
 * Opens the database (PGlite on a developer machine when no Postgres URL is
 * set; hosted Postgres on Vercel). Safe to call on every request — the
 * connection is reused.
 */
export async function getDb(): Promise<Database> {
  if (override) return override

  const url = readEnv('DATABASE_URL')
  if (readEnv('VERCEL') && isPgliteUrl(url)) {
    throw invalid(
      'DATABASE_URL must be a Postgres connection string on Vercel.',
    )
  }

  const cacheKey = url ?? 'pglite:.data/pglite'
  if (cached && cached.url === cacheKey) return cached.db

  if (!starting) {
    starting = (isPgliteUrl(url) ? openPglite(url) : openPostgres(url!))
      .then((db) => {
        cached = { db, url: cacheKey }
        return db
      })
      .finally(() => {
        starting = undefined
      })
  }

  return starting
}

export { schema }
