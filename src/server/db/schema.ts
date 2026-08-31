import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const memberStatus = pgEnum('member_status', [
  'pending',
  'approved',
  'suspended',
])

export const applicationStatus = pgEnum('application_status', [
  'pending',
  'approved',
  'declined',
])

export const requestStatus = pgEnum('request_status', [
  'pending',
  'approved',
  'declined',
  'changes_requested',
])

export const ledgerKind = pgEnum('ledger_kind', ['award', 'adjustment'])

export const notificationStatus = pgEnum('notification_status', [
  'pending',
  'sent',
  'failed',
])

export const certificateScope = pgEnum('certificate_scope', [
  'award',
  'summary',
])

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  /** System roles cannot be renamed or deleted, only their permissions change. */
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
)

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Google's stable subject identifier. Never changes, unlike email. */
    googleSub: text('google_sub').notNull().unique(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    googleName: text('google_name'),
    avatarUrl: text('avatar_url'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    discordHandle: text('discord_handle'),
    phone: text('phone'),
    status: memberStatus('status').notNull().default('pending'),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('users_status_idx').on(t.status),
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
  ],
)

export const membershipApplications = pgTable(
  'membership_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    discordHandle: text('discord_handle').notNull(),
    phone: text('phone'),
    status: applicationStatus('status').notNull().default('pending'),
    decisionNote: text('decision_note'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('applications_status_idx').on(t.status),
    /** A member may resubmit after a decline, but never stack pending applications. */
    uniqueIndex('applications_one_pending_per_user_uq')
      .on(t.userId)
      .where(sql`status = 'pending'`),
  ],
)

export const volunteerRequests = pgTable(
  'volunteer_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serviceDate: date('service_date').notNull(),
    activity: text('activity').notNull(),
    /** Stored as whole minutes so ledger sums stay exact. */
    minutes: integer('minutes').notNull(),
    notes: text('notes'),
    status: requestStatus('status').notNull().default('pending'),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    reviewNote: text('review_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('requests_status_idx').on(t.status),
    index('requests_user_idx').on(t.userId),
  ],
)

export const requestAttachments = pgTable(
  'request_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => volunteerRequests.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('attachments_request_idx').on(t.requestId)],
)

export const hourLedger = pgTable(
  'hour_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').references(() => volunteerRequests.id, {
      onDelete: 'set null',
    }),
    kind: ledgerKind('kind').notNull(),
    /** Adjustments may be negative; awards are always positive. */
    minutes: integer('minutes').notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('ledger_user_idx').on(t.userId),
    /** Guarantees an approved request can never be awarded twice. */
    uniqueIndex('ledger_one_award_per_request_uq')
      .on(t.requestId)
      .where(sql`kind = 'award'`),
  ],
)

export const certificates = pgTable(
  'certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    verificationId: text('verification_id').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: certificateScope('scope').notNull(),
    awardId: uuid('award_id').references(() => hourLedger.id, {
      onDelete: 'cascade',
    }),
    totalMinutes: integer('total_minutes').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('certificates_user_idx').on(t.userId)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Only the hash is stored so a database leak cannot resurrect sessions. */
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const oauthAttempts = pgTable('oauth_attempts', {
  state: text('state').primaryKey(),
  codeVerifier: text('code_verifier').notNull(),
  redirectTo: text('redirect_to'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: notificationStatus('status').notNull().default('pending'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId)],
)

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
)

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  applications: many(membershipApplications),
  requests: many(volunteerRequests),
  ledger: many(hourLedger),
}))

export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  users: many(users),
}))

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
}))

export const volunteerRequestsRelations = relations(
  volunteerRequests,
  ({ one, many }) => ({
    user: one(users, {
      fields: [volunteerRequests.userId],
      references: [users.id],
    }),
    attachments: many(requestAttachments),
  }),
)

export const requestAttachmentsRelations = relations(
  requestAttachments,
  ({ one }) => ({
    request: one(volunteerRequests, {
      fields: [requestAttachments.requestId],
      references: [volunteerRequests.id],
    }),
  }),
)

export const hourLedgerRelations = relations(hourLedger, ({ one }) => ({
  user: one(users, { fields: [hourLedger.userId], references: [users.id] }),
  request: one(volunteerRequests, {
    fields: [hourLedger.requestId],
    references: [volunteerRequests.id],
  }),
}))

export type Role = typeof roles.$inferSelect
export type User = typeof users.$inferSelect
export type MembershipApplication = typeof membershipApplications.$inferSelect
export type VolunteerRequest = typeof volunteerRequests.$inferSelect
export type RequestAttachment = typeof requestAttachments.$inferSelect
export type LedgerEntry = typeof hourLedger.$inferSelect
export type Certificate = typeof certificates.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type AuditEvent = typeof auditEvents.$inferSelect
