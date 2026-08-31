import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  generateVerificationId,
  signPayload,
  verifyPayload,
} from '~/server/tokens'
import { assertSafeKey, buildAttachmentKey } from '~/server/storage'
import { createLocalDriver } from '~/server/storage/local'
import { buildCookie, readCookie } from '~/server/auth/session'
import { readAttachmentToken } from '~/server/functions/attachments'
import { sessionSecret } from '~/server/env'

let tempDir: string

beforeAll(async () => {
  process.env.SESSION_SECRET = 'unit-test-secret'
  process.env.APP_ORIGIN = 'http://localhost:3000'
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vh-storage-'))
  process.env.LOCAL_STORAGE_DIR = tempDir
})

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('session secret', () => {
  it('uses a localhost fallback when SESSION_SECRET is unset off Vercel', () => {
    const previous = process.env.SESSION_SECRET
    const vercel = process.env.VERCEL
    delete process.env.SESSION_SECRET
    delete process.env.VERCEL

    expect(sessionSecret()).toBe('vhsystem-local-dev-only')

    process.env.SESSION_SECRET = previous
    if (vercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = vercel
  })
})

describe('signed tokens', () => {
  it('round trips a payload', () => {
    const token = signPayload({ attachmentId: 'a1', viewerId: 'u1' }, 60)
    const payload = verifyPayload<{ attachmentId: string; viewerId: string }>(token)

    expect(payload?.attachmentId).toBe('a1')
    expect(payload?.viewerId).toBe('u1')
  })

  it('rejects a tampered payload', () => {
    const token = signPayload({ attachmentId: 'a1', viewerId: 'u1' }, 60)
    const [body, signature] = token.split('.') as [string, string]
    const forged = Buffer.from(
      JSON.stringify({ attachmentId: 'a1', viewerId: 'attacker', exp: 9e9 }),
    ).toString('base64url')

    expect(verifyPayload(`${forged}.${signature}`)).toBeNull()
    expect(verifyPayload(`${body}.${signature}x`)).toBeNull()
    expect(verifyPayload('garbage')).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const token = signPayload({ attachmentId: 'a1', viewerId: 'u1' }, 60)
    process.env.SESSION_SECRET = 'a-different-secret'
    expect(verifyPayload(token)).toBeNull()
    process.env.SESSION_SECRET = 'unit-test-secret'
  })

  it('expires on its own', () => {
    const token = signPayload({ attachmentId: 'a1', viewerId: 'u1' }, 60)
    expect(verifyPayload(token)).not.toBeNull()

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 61_000)
    expect(verifyPayload(token)).toBeNull()
    vi.useRealTimers()
  })

  it('rejects an attachment token issued for a different attachment shape', () => {
    const token = signPayload({ somethingElse: 'x' }, 60)
    expect(readAttachmentToken(token)).toBeNull()
  })
})

describe('verification ids', () => {
  it('uses an unambiguous alphabet and a stable shape', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = generateVerificationId()
      expect(id).toMatch(/^VH-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
    }
  })

  it('does not repeat across many draws', () => {
    const ids = new Set(Array.from({ length: 500 }, generateVerificationId))
    expect(ids.size).toBe(500)
  })
})

describe('cookies', () => {
  it('marks session cookies HttpOnly, SameSite and path scoped', () => {
    const cookie = buildCookie('vh_session', 'abc', 3600)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=3600')
  })

  it('adds Secure only on an https origin', () => {
    expect(buildCookie('vh_session', 'abc', 60)).not.toContain('Secure')

    process.env.APP_ORIGIN = 'https://hours.example.org'
    expect(buildCookie('__Host-vh_session', 'abc', 60)).toContain('Secure')
    process.env.APP_ORIGIN = 'http://localhost:3000'
  })

  it('reads a cookie value containing base64 padding', () => {
    const header = 'other=1; vh_session=abc==; another=2'
    expect(readCookie(header, 'vh_session')).toBe('abc==')
    expect(readCookie(header, 'missing')).toBeNull()
    expect(readCookie(undefined, 'vh_session')).toBeNull()
  })
})

describe('storage keys', () => {
  it('namespaces by request and never reuses the original file name', () => {
    const key = buildAttachmentKey('req-1', 'image/jpeg')
    expect(key.startsWith('requests/req-1/')).toBe(true)
    expect(key.endsWith('.jpg')).toBe(true)
  })

  it('rejects keys that could escape the storage root', () => {
    expect(() => assertSafeKey('../../etc/passwd')).toThrow()
    expect(() => assertSafeKey('/etc/passwd')).toThrow()
    expect(() => assertSafeKey('a\\b')).toThrow()
    expect(() => assertSafeKey('')).toThrow()
    expect(() => assertSafeKey('requests/ok/file.jpg')).not.toThrow()
  })
})

describe('local storage driver', () => {
  it('stores, reads back and deletes an object with its content type', async () => {
    const driver = createLocalDriver()
    const key = 'requests/abc/photo.png'
    const body = Buffer.from('binary-content')

    await driver.put(key, body, 'image/png')

    const stored = await driver.get(key)
    expect(stored?.body.toString()).toBe('binary-content')
    expect(stored?.contentType).toBe('image/png')

    await driver.remove(key)
    expect(await driver.get(key)).toBeNull()
  })

  it('returns null for an object that was never written', async () => {
    const driver = createLocalDriver()
    expect(await driver.get('requests/none/missing.png')).toBeNull()
  })

  it('refuses to read outside its root', async () => {
    const driver = createLocalDriver()
    await expect(driver.get('../../../etc/hosts')).rejects.toThrow()
  })
})
