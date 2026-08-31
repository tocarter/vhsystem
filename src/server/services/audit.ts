import { desc, eq } from 'drizzle-orm'
import { getDb, schema, type Executor } from '../db'

export type AuditInput = {
  actorId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}

export async function recordAudit(
  executor: Executor,
  input: AuditInput,
): Promise<void> {
  await executor.insert(schema.auditEvents).values({
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? null,
  })
}

export type AuditRow = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  /** Serialized for transport; the audit screen only ever displays it. */
  metadata: string | null
  createdAt: Date
  actor: { id: string; email: string; firstName: string | null; lastName: string | null } | null
}

export async function listAuditEvents(limit = 100): Promise<Array<AuditRow>> {
  const db = await getDb()
  const rows = await db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      entityType: schema.auditEvents.entityType,
      entityId: schema.auditEvents.entityId,
      metadata: schema.auditEvents.metadata,
      createdAt: schema.auditEvents.createdAt,
      actorId: schema.users.id,
      actorEmail: schema.users.email,
      actorFirstName: schema.users.firstName,
      actorLastName: schema.users.lastName,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.auditEvents.actorId, schema.users.id))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(limit)

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata ? JSON.stringify(row.metadata) : null,
    createdAt: row.createdAt,
    actor: row.actorId
      ? {
          id: row.actorId,
          email: row.actorEmail!,
          firstName: row.actorFirstName,
          lastName: row.actorLastName,
        }
      : null,
  }))
}
