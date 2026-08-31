import { and, eq, gt, lt } from 'drizzle-orm'
import {
  getRequestHeader,
  setResponseHeader,
} from '@tanstack/react-start/server'
import { getDb, schema } from '../db'
import { isSecureOrigin } from '../env'
import { randomToken, sha256 } from '../tokens'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

/**
 * The `__Host-` prefix pins the cookie to this exact origin, but it requires
 * `Secure`, which localhost over http cannot satisfy.
 */
export function sessionCookieName(): string {
  return isSecureOrigin() ? '__Host-vh_session' : 'vh_session'
}

export function buildCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  const parts = [
    `${name}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (isSecureOrigin()) parts.splice(2, 0, 'Secure')
  return parts.join('; ')
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq) === name) return part.slice(eq + 1)
  }
  return null
}

export function readSessionToken(): string | null {
  return readCookie(getRequestHeader('cookie'), sessionCookieName())
}

export function sessionCookieFor(token: string): string {
  return buildCookie(sessionCookieName(), token, SESSION_TTL_SECONDS)
}

export function clearedSessionCookie(): string {
  return buildCookie(sessionCookieName(), '', 0)
}

export function setSessionCookie(token: string) {
  setResponseHeader('Set-Cookie', sessionCookieFor(token))
}

export function clearSessionCookie() {
  setResponseHeader('Set-Cookie', clearedSessionCookie())
}

/**
 * Returns the raw token for the cookie; only its hash is persisted so a
 * database dump cannot be replayed as a live session.
 */
export async function createSession(userId: string): Promise<string> {
  const db = await getDb()
  const token = randomToken(32)
  await db.insert(schema.sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  })
  return token
}

export async function findSessionUserId(token: string): Promise<string | null> {
  const db = await getDb()
  const rows = await db
    .select({ userId: schema.sessions.userId })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.tokenHash, sha256(token)),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return rows[0]?.userId ?? null
}

export async function revokeSession(token: string): Promise<void> {
  const db = await getDb()
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.tokenHash, sha256(token)))
}

/** Called on privilege changes so a fixated session cannot outlive them. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  const db = await getDb()
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId))
}

export async function deleteExpiredSessions(): Promise<void> {
  const db = await getDb()
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()))
}
