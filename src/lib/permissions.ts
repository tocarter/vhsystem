/**
 * Capabilities are the unit of authorization. Roles are just named bundles of
 * them, so a new role never requires touching authorization checks.
 */
export const PERMISSIONS = {
  'members.view': 'View the member directory',
  'members.review': 'Approve or decline membership applications',
  'members.manage': 'Suspend, reactivate, and edit members',
  'members.assign_role': "Change a member's role",
  'requests.submit': 'Submit volunteer hour requests',
  'requests.view_own': 'View own volunteer hour requests and records',
  'requests.view_all': 'View every volunteer hour request',
  'requests.review': 'Approve, decline, or return volunteer hour requests',
  'hours.adjust': 'Post correcting adjustments to the hour ledger',
  'roles.manage': 'Create roles and change their permissions',
  'audit.view': 'View the audit history',
} as const

export type Permission = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Array<Permission>

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value)
}

export const SYSTEM_ROLE_KEYS = {
  admin: 'admin',
  member: 'member',
} as const

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Array<Permission>> = {
  [SYSTEM_ROLE_KEYS.admin]: [...ALL_PERMISSIONS],
  [SYSTEM_ROLE_KEYS.member]: ['requests.submit', 'requests.view_own'],
}

export type Viewer = {
  id: string
  status: 'pending' | 'approved' | 'suspended'
  permissions: ReadonlyArray<Permission>
}

/**
 * Only approved members can exercise any capability. Suspending a member is
 * therefore a single switch that revokes everything without editing roles.
 */
export function can(viewer: Viewer | null, permission: Permission): boolean {
  if (!viewer) return false
  if (viewer.status !== 'approved') return false
  return viewer.permissions.includes(permission)
}

export function canAny(
  viewer: Viewer | null,
  permissions: ReadonlyArray<Permission>,
): boolean {
  return permissions.some((permission) => can(viewer, permission))
}

/** A member may always read their own record even without `requests.view_all`. */
export function canViewMemberRecords(
  viewer: Viewer | null,
  targetUserId: string,
): boolean {
  if (!viewer) return false
  if (can(viewer, 'requests.view_all')) return true
  return viewer.id === targetUserId && can(viewer, 'requests.view_own')
}
