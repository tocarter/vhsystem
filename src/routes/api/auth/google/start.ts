import { createFileRoute } from '@tanstack/react-router'
import { lt } from 'drizzle-orm'
import { AppError } from '~/lib/errors'
import { safeRedirectPath } from '~/lib/routing'
import { getDb, schema } from '~/server/db'
import {
  buildAuthorizationUrl,
  newPkcePair,
} from '~/server/auth/google'
import { buildCookie, deleteExpiredSessions } from '~/server/auth/session'
import { oauthStateCookieName } from '~/server/auth/oauth-cookie'
import { googleAuthConfigured } from '~/server/env'
import { randomToken } from '~/server/tokens'

const ATTEMPT_TTL_SECONDS = 10 * 60

function failure(message: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/?error=${encodeURIComponent(message)}`,
      'Cache-Control': 'no-store',
    },
  })
}

export const Route = createFileRoute('/api/auth/google/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!googleAuthConfigured()) {
          return failure(
            'Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart the server.',
          )
        }

        try {
          const url = new URL(request.url)
          const redirectTo = safeRedirectPath(
            url.searchParams.get('redirect') ?? undefined,
          )

          const db = await getDb()
          // Opportunistic housekeeping on a low-traffic endpoint.
          await db
            .delete(schema.oauthAttempts)
            .where(lt(schema.oauthAttempts.expiresAt, new Date()))
          await deleteExpiredSessions()

          const state = randomToken(32)
          const { verifier, challenge } = newPkcePair()

          await db.insert(schema.oauthAttempts).values({
            state,
            codeVerifier: verifier,
            redirectTo,
            expiresAt: new Date(Date.now() + ATTEMPT_TTL_SECONDS * 1000),
          })

          const headers = new Headers({
            Location: buildAuthorizationUrl({ state, codeChallenge: challenge }),
          })
          // Binding the state to a cookie means an attacker cannot finish a flow
          // they did not start in this browser.
          headers.append(
            'Set-Cookie',
            buildCookie(oauthStateCookieName(), state, ATTEMPT_TTL_SECONDS),
          )
          headers.append('Cache-Control', 'no-store')

          return new Response(null, { status: 302, headers })
        } catch (error) {
          if (error instanceof AppError) return failure(error.message)
          console.error('Google sign-in start failed', error)
          return failure(
            'Could not start Google sign-in. Check the database and try again.',
          )
        }
      },
    },
  },
})
