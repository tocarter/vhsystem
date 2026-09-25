import type { ReactNode } from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import type { RouterContext } from '~/router'
import { fetchSessionUser } from '~/server/functions/session'
import appCss from '~/styles.css?url'

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light' },
      { title: 'Volunteer Hours System' },
      {
        name: 'description',
        content:
          'Track, review and verify volunteer service hours for your team.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  /**
   * Loaded once per navigation and shared with every child route, so guards
   * never need to refetch the session.
   */
  beforeLoad: async () => ({ session: await fetchSessionUser() }),
  component: RootComponent,
  notFoundComponent: NotFound,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()

  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-2 text-slate-600">
          The page you were looking for does not exist.
        </p>
        <a href="/" className="btn-primary mt-6">
          Back to the portal
        </a>
      </div>
    </div>
  )
}
