import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

try {
  process.loadEnvFile('.env')
} catch {
  // DATABASE_URL may already be in the environment (CI, Vercel, shell).
}

const url = process.env.DATABASE_URL
if (!url || url.startsWith('pglite:') || url.startsWith('file:')) {
  console.info(
    'PGlite applies migrations on first connect. Nothing to do here.',
  )
  process.exit(0)
}

// A single non-pooled connection: migrations must run serially.
const client = postgres(url, { max: 1 })

try {
  await migrate(drizzle(client), { migrationsFolder: './drizzle' })
  console.info('Migrations applied.')
} catch (error) {
  console.error('Migration failed:', error)
  process.exitCode = 1
} finally {
  await client.end()
}
