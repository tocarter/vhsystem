import { createFileRoute, redirect } from '@tanstack/react-router'
import { can } from '~/lib/permissions'
import { EmptyState, PageHeader, formatDateTime } from '~/components/ui'
import { fetchAuditEvents } from '~/server/functions/roles'

const ACTION_LABELS: Record<string, string> = {
  'auth.registered': 'signed in for the first time',
  'auth.signed_in': 'signed in',
  'auth.bootstrap_admin': 'was provisioned as the first administrator',
  'application.submitted': 'submitted a registration',
  'application.approved': 'approved a registration',
  'application.declined': 'declined a registration',
  'member.suspended': 'suspended a member',
  'member.reactivated': 'reactivated a member',
  'member.role_changed': "changed a member's role",
  'member.profile_updated': 'updated a profile',
  'request.submitted': 'submitted volunteer hours',
  'request.updated': 'updated a volunteer hour request',
  'request.approved': 'approved volunteer hours',
  'request.declined': 'declined volunteer hours',
  'request.changes_requested': 'asked for changes on a request',
  'hours.adjusted': 'posted an hour correction',
  'role.created': 'created a role',
  'role.updated': 'updated a role',
  'role.deleted': 'deleted a role',
}

export const Route = createFileRoute('/_app/admin/audit')({
  beforeLoad: ({ context }) => {
    if (!can(context.viewer, 'audit.view')) throw redirect({ to: '/admin' })
  },
  loader: () => fetchAuditEvents({ data: { limit: 200 } }),
  component: AuditPage,
})

function AuditPage() {
  const events = Route.useLoaderData()

  return (
    <div>
      <PageHeader
        title="Audit history"
        description="Every decision that changes a member's access or their hour record."
      />

      {events.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <ol className="card divide-y divide-slate-100">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">
                  <span className="font-semibold">
                    {event.actor
                      ? [event.actor.firstName, event.actor.lastName]
                          .filter(Boolean)
                          .join(' ') || event.actor.email
                      : 'System'}
                  </span>{' '}
                  {ACTION_LABELS[event.action] ?? event.action}
                </p>
                {event.metadata ? (
                  <p className="mt-0.5 font-mono text-xs break-all text-slate-500">
                    {event.metadata}
                  </p>
                ) : null}
              </div>
              <time className="shrink-0 text-xs text-slate-500">
                {formatDateTime(event.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
