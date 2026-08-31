import { eq, sql } from 'drizzle-orm'
import { getDb, schema, type Executor } from '../db'
import { appOrigin, organization, readEnv, requireEnv } from '../env'
import type { EmailBrand, EmailContent } from './templates'

export type SendResult = { providerMessageId: string | null }

export type EmailDriver = {
  readonly name: string
  send(message: {
    to: string
    subject: string
    text: string
    html: string
  }): Promise<SendResult>
}

let driverOverride: EmailDriver | undefined

export function setEmailDriverForTesting(driver: EmailDriver | undefined) {
  driverOverride = driver
}

function consoleDriver(): EmailDriver {
  return {
    name: 'console',
    async send(message) {
      console.info(
        `[email] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
      )
      return { providerMessageId: null }
    },
  }
}

function resendDriver(): EmailDriver {
  return {
    name: 'resend',
    async send(message) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: requireEnv('EMAIL_FROM'),
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      })

      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`Resend rejected the message (${response.status}): ${detail}`)
      }

      const payload = (await response.json()) as { id?: string }
      return { providerMessageId: payload.id ?? null }
    },
  }
}

export function getEmailDriver(): EmailDriver {
  if (driverOverride) return driverOverride
  return readEnv('EMAIL_DRIVER') === 'resend' ? resendDriver() : consoleDriver()
}

export function emailBrand(): EmailBrand {
  return { orgName: organization().name, appOrigin: appOrigin() }
}

/**
 * Queued inside the caller's transaction so a notification is never recorded
 * for work that rolled back, and never lost for work that committed.
 */
export async function queueNotification(
  executor: Executor,
  input: {
    userId: string | null
    type: string
    toEmail: string
    content: EmailContent
  },
): Promise<string> {
  const rows = await executor
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      type: input.type,
      toEmail: input.toEmail,
      subject: input.content.subject,
      body: input.content.text,
      status: 'pending',
    })
    .returning({ id: schema.notifications.id })

  return rows[0]!.id
}

/**
 * Delivery happens after commit. Failures are recorded rather than thrown so a
 * mail outage never rolls back an approval that already happened.
 */
export async function dispatchNotification(
  notificationId: string,
  content: EmailContent,
): Promise<boolean> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.id, notificationId))
    .limit(1)

  const notification = rows[0]
  if (!notification || notification.status === 'sent') return false

  try {
    const result = await getEmailDriver().send({
      to: notification.toEmail,
      subject: content.subject,
      text: content.text,
      html: content.html,
    })

    await db
      .update(schema.notifications)
      .set({
        status: 'sent',
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        error: null,
        attempts: sql`${schema.notifications.attempts} + 1`,
      })
      .where(eq(schema.notifications.id, notificationId))

    return true
  } catch (error) {
    await db
      .update(schema.notifications)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        attempts: sql`${schema.notifications.attempts} + 1`,
      })
      .where(eq(schema.notifications.id, notificationId))

    return false
  }
}