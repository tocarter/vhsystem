import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { canAny, type Permission } from '~/lib/permissions'

const ADMIN_AREA_PERMISSIONS: Array<Permission> = [
  'members.view',
  'members.review',
  'requests.view_all',
  'requests.review',
  'roles.manage',
  'audit.view',
]

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => {
    const { session } = context
    const viewer = {
      id: session.id,
      status: session.status,
      permissions: session.permissions,
    }
    if (!canAny(viewer, ADMIN_AREA_PERMISSIONS)) {
      throw redirect({ to: '/dashboard' })
    }
    return { viewer }
  },
  component: () => <Outlet />,
})
