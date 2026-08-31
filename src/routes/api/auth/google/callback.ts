import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { AppError } from '~/lib/errors'
import { destinationAfterLogin } from '~/lib/routing'
import { getDb, schema } from '~/server/db'
import { exchangeCodeForClaims } from '~/server/auth/google'
import { oauthStateCookieName } from '~/server/auth/oauth-cookie'
import {
  buildCookie,
  createSession,
  readCookie,
  sessionCookieFor,
} from '~/server/auth/session'
import { loadViewer } from '~/server/auth/viewer'
import { signInWithGoogle } from '~/server/services/members'
import { timingSafeEqual } from '~/server/tokens'

function failure(message: string): Response {
  const headers = new Headers({
    Location: `/?error=${encodeURIComponent(message)}`,
    'Cache-Control': 'no-store',
  })
  headers.append('Set-Cookie', buildCookie(oauthStateCookieName(), '', 0))
  return new Response(null, { status: 302, headers })
}

export const Route = createFileRoute('/api/auth/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)

        const oauthError = url.searchParams.get('error')
        if (oauthError) {
          return failure(
            oauthError === 'access_denied'
              ? 'Sign-in was cancelled.'
              : 'Google could not complete the sign-in.',
          )
        }

        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        if (!code || !state) return failure('The sign-in link was incomplete.')

        const cookieState = readCookie(
          request.headers.get('cookie') ?? undefined,
          oauthStateCookieName(),
        )
        if (!cookieState || !timingSafeEqual(cookieState, state)) {
          return failure('The sign-in attempt did not start in this browser.')
        }

        const db = await getDb()

        // Deleting on read makes each authorization code single use.
        const attempts = await db
          .delete(schema.oauthAttempts)
          .where(eq(schema.oauthAttempts.state, state))
          .returning()

        const attempt = attempts[0]
        if (!attempt) return failure('That sign-in link was already used.')
        if (attempt.expiresAt.getTime() < Date.now()) {
          return failure('That sign-in link expired. Please try again.')
        }

        try {
          const claims = await exchangeCodeForClaims({
            code,
            codeVerifier: attempt.codeVerifier,
          })

          const userId = await signInWithGoogle(claims)
          const viewer = await loadViewer(userId)
          const token = await createSession(userId)
          const destination = destinationAfterLogin(
            viewer,
            attempt.redirectTo,
          )

          const headers = new Headers({
            Location: destination,
            'Cache-Control': 'no-store',
          })
          headers.append('Set-Cookie', sessionCookieFor(token))
          headers.append('Set-Cookie', buildCookie(oauthStateCookieName(), '', 0))

          return new Response(null, { status: 302, headers })
        } catch (error) {
          if (error instanceof AppError) return failure(error.message)
          console.error('Google sign-in failed', error)
          return failure('Sign-in failed. Please try again.')
        }
      },
    },
  },
})
