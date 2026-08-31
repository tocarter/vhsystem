import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  can,
  canAny,
  canViewMemberRecords,
  isPermission,
  type Viewer,
} from '~/lib/permissions'

const approvedAdmin: Viewer = {
  id: 'admin-1',
  status: 'approved',
  permissions: [...ALL_PERMISSIONS],
}

const approvedMember: Viewer = {
  id: 'member-1',
  status: 'approved',
  permissions: ['requests.submit', 'requests.view_own'],
}

describe('permission checks', () => {
  it('grants a capability the role actually holds', () => {
    expect(can(approvedMember, 'requests.submit')).toBe(true)
    expect(can(approvedAdmin, 'roles.manage')).toBe(true)
  })

  it('denies a capability the role does not hold', () => {
    expect(can(approvedMember, 'requests.review')).toBe(false)
    expect(can(approvedMember, 'members.view')).toBe(false)
  })

  it('denies everything to an unauthenticated viewer', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(can(null, permission)).toBe(false)
    }
  })

  it('revokes every capability while a membership is not approved', () => {
    const pending: Viewer = { ...approvedAdmin, status: 'pending' }
    const suspended: Viewer = { ...approvedAdmin, status: 'suspended' }

    for (const permission of ALL_PERMISSIONS) {
      expect(can(pending, permission)).toBe(false)
      expect(can(suspended, permission)).toBe(false)
    }
  })

  it('treats canAny as a union of capabilities', () => {
    expect(canAny(approvedMember, ['requests.review', 'requests.submit'])).toBe(true)
    expect(canAny(approvedMember, ['requests.review', 'members.view'])).toBe(false)
    expect(canAny(null, ['requests.submit'])).toBe(false)
  })
})

describe('record visibility', () => {
  it('lets a member read only their own record', () => {
    expect(canViewMemberRecords(approvedMember, 'member-1')).toBe(true)
    expect(canViewMemberRecords(approvedMember, 'member-2')).toBe(false)
  })

  it('lets a reviewer read anyone', () => {
    expect(canViewMemberRecords(approvedAdmin, 'member-2')).toBe(true)
  })

  it('denies a suspended member their own record', () => {
    const suspended: Viewer = { ...approvedMember, status: 'suspended' }
    expect(canViewMemberRecords(suspended, 'member-1')).toBe(false)
  })
})

describe('permission catalog', () => {
  it('recognises known permissions and rejects invented ones', () => {
    expect(isPermission('requests.review')).toBe(true)
    expect(isPermission('requests.destroy_everything')).toBe(false)
  })

  it('gives the built-in member role no administrative capability', () => {
    const memberPermissions = DEFAULT_ROLE_PERMISSIONS.member ?? []
    expect(memberPermissions).not.toContain('requests.review')
    expect(memberPermissions).not.toContain('members.review')
    expect(memberPermissions).not.toContain('roles.manage')
  })

  it('gives the built-in admin role every capability', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toEqual([...ALL_PERMISSIONS])
  })
})
