import { describe, expect, it } from 'vitest'
import { destinationAfterLogin, homeFor, safeRedirectPath } from '~/lib/routing'
import type { SessionUser } from '~/lib/viewer'

function session(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: 'user-1',
    email: 'nova@example.org',
    firstName: 'Nova',
    lastName: 'Hart',
    discordHandle: 'nova.hart',
    phone: null,
    avatarUrl: null,
    status: 'approved',
    role: { key: 'user', name: 'Member' },
    permissions: [],
    hasSubmittedApplication: true,
    ...overrides,
  }
}

describe('homeFor', () => {
  it('sends a signed-out visitor to the landing page', () => {
    expect(homeFor(null)).toBe('/')
  })

  it('sends a brand new account to registration', () => {
    expect(
      homeFor(session({ status: 'pending', hasSubmittedApplication: false })),
    ).toBe('/register')
  })

  it('sends an applicant awaiting review to the waiting screen', () => {
    expect(
      homeFor(session({ status: 'pending', hasSubmittedApplication: true })),
    ).toBe('/pending')
  })

  it('sends a suspended member to the suspended screen', () => {
    expect(homeFor(session({ status: 'suspended' }))).toBe('/suspended')
  })

  it('sends an approved member to the dashboard', () => {
    expect(homeFor(session({ status: 'approved' }))).toBe('/dashboard')
  })
})

describe('destinationAfterLogin', () => {
  it('sends an unmatched new account to registration even if a deep link was requested', () => {
    expect(
      destinationAfterLogin(
        session({ status: 'pending', hasSubmittedApplication: false }),
        '/admin',
      ),
    ).toBe('/register')
  })

  it('lets an approved member follow a safe deep link', () => {
    expect(destinationAfterLogin(session({ status: 'approved' }), '/admin')).toBe(
      '/admin',
    )
  })
})

describe('safeRedirectPath', () => {
  it('keeps same-origin paths', () => {
    expect(safeRedirectPath('/dashboard')).toBe('/dashboard')
    expect(safeRedirectPath('/admin/requests/abc?tab=evidence')).toBe(
      '/admin/requests/abc?tab=evidence',
    )
  })

  it('returns null when there is nothing to redirect to', () => {
    expect(safeRedirectPath(undefined)).toBeNull()
    expect(safeRedirectPath('')).toBeNull()
  })

  it('rejects anything that could leave the origin', () => {
    for (const hostile of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      'javascript:alert(1)',
      'dashboard',
      '\t/dashboard',
    ]) {
      expect(safeRedirectPath(hostile), hostile).toBeNull()
    }
  })

  it('rejects header-splitting and absurdly long values', () => {
    expect(safeRedirectPath('/dashboard\nLocation: https://evil.example')).toBeNull()
    expect(safeRedirectPath(`/${'a'.repeat(600)}`)).toBeNull()
  })
})
