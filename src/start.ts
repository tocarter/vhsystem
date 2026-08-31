import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({
      /**
       * Only state-changing requests are origin-checked. Plain page loads and
       * the Google OAuth redirect are cross-site GETs by design.
       */
      filter: ({ request }) =>
        request.method !== 'GET' && request.method !== 'HEAD',
    }),
  ],
}))
