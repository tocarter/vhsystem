import { useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { canAny, type Permission } from '~/lib/permissions'
import { displayName, initials } from '~/lib/viewer'
import { Avatar, classNames } from '~/components/ui'
import { signOut } from '~/server/functions/session'

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({
        to: '/',
        search: { redirect: `${location.pathname}${location.search}` },
      })
    }
    // Narrows `session` to non-null for every route nested below.
    return { session: context.session }
  },
  component: AppLayout,
})

type NavItem = { to: string; label: string; permissions?: Array<Permission> }

function AppLayout() {
  const { session } = Route.useRouteContext()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  const signOutMutation = useMutation({
    mutationFn: () => signOut(),
    onSettled: async () => {
      await router.invalidate()
      router.navigate({ href: '/' })
    },
  })

  const viewer = {
    id: session.id,
    status: session.status,
    permissions: session.permissions,
  }

  const items: Array<NavItem> = [
    { to: '/dashboard', label: 'My hours', permissions: ['requests.view_own'] },
    { to: '/requests/new', label: 'Log hours', permissions: ['requests.submit'] },
    {
      to: '/admin',
      label: 'Review queue',
      permissions: ['requests.review', 'members.review'],
    },
    {
      to: '/admin/people',
      label: 'People',
      permissions: ['members.view'],
    },
    { to: '/admin/roles', label: 'Roles', permissions: ['roles.manage'] },
    { to: '/admin/audit', label: 'Audit', permissions: ['audit.view'] },
  ]

  const visible = items.filter(
    (item) => !item.permissions || canAny(viewer, item.permissions),
  )

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/dashboard" className="flex shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              V
            </span>
            <span className="hidden text-sm font-bold tracking-tight text-slate-900 sm:block">
              Volunteer Hours
            </span>
          </Link>

          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {visible.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === '/admin' }}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 data-[status=active]:bg-brand-50 data-[status=active]:text-brand-700"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 transition hover:bg-slate-100"
            >
              <Avatar
                src={session.avatarUrl}
                initials={initials(session)}
                size={32}
              />
              <span className="hidden max-w-[10rem] truncate text-sm font-medium text-slate-700 sm:block">
                {displayName(session)}
              </span>
            </button>

            {menuOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
                >
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {displayName(session)}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {session.email}
                    </p>
                    <p className="mt-1.5 text-xs font-medium text-brand-700">
                      {session.role.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => signOutMutation.mutate()}
                    disabled={signOutMutation.isPending}
                    className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {signOutMutation.isPending ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {visible.length > 0 ? (
          <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2 md:hidden">
            {visible.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === '/admin' }}
                className={classNames(
                  'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600',
                  'data-[status=active]:bg-brand-50 data-[status=active]:text-brand-700',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
