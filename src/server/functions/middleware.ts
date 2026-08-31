import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { AppError, forbidden, unauthenticated } from '~/lib/errors'
import { can, type Permission } from '~/lib/permissions'
import { requireViewer, toPermissionViewer } from '../auth/viewer'

/**
 * The data boundary. Every server function that touches member data composes
 * one of these, because a route guard alone does not protect an endpoint that
 * is reachable on its own.
 */
export const authedMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const viewer = await requireViewer()
    return next({ context: { viewer } })
  },
)

export const approvedMiddleware = createMiddleware({ type: 'function' })
  .middleware([authedMiddleware])
  .server(async ({ next, context }) => {
    if (context.viewer.status !== 'approved') {
      throw forbidden('Your membership is not active yet.')
    }
    return next({ context })
  })

export function permissionMiddleware(permission: Permission) {
  return createMiddleware({ type: 'function' })
    .middleware([authedMiddleware])
    .server(async ({ next, context }) => {
      if (!can(toPermissionViewer(context.viewer), permission)) {
        throw forbidden()
      }
      return next({ context })
    })
}

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

/**
 * Per-instance sliding window. Enough to blunt scripted abuse of the sign-in
 * and submission endpoints; a shared store would be needed for strict limits
 * across many serverless instances.
 */
export function rateLimitMiddleware(options: {
  key: string
  max: number
  windowMs: number
}) {
  return createMiddleware({ type: 'function' }).server(async ({ next }) => {
    const request = getRequest()
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('cf-connecting-ip') ??
      'unknown'
    const key = `${options.key}:${ip}`
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs })
    } else if (bucket.count >= options.max) {
      throw new AppError('rate_limited', 'Too many attempts. Try again shortly.')
    } else {
      bucket.count += 1
    }

    if (buckets.size > 5000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(entryKey)
      }
    }

    return next()
  })
}

export { unauthenticated }
