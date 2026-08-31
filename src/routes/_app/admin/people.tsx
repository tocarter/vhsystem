import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { can } from '~/lib/permissions'
import { formatHours } from '~/lib/hours'
import {
  Avatar,
  EmptyState,
  ErrorNotice,
  PageHeader,
  StatusBadge,
  classNames,
  errorMessage,
  formatDate,
  formatDateTime,
} from '~/components/ui'
import {
  changeMemberRole,
  changeMemberStatus,
  fetchPeopleDirectory,
} from '~/server/functions/members'
import { fetchMemberRecord, postAdjustment } from '~/server/functions/hours'

const searchSchema = z.object({
  status: z.enum(['pending', 'approved', 'suspended']).optional(),
  q: z.string().optional(),
})

export const Route = createFileRoute('/_app/admin/people')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!can(context.viewer, 'members.view')) throw redirect({ to: '/admin' })
  },
  loaderDeps: ({ search }) => ({ status: search.status, q: search.q }),
  loader: ({ deps }) =>
    fetchPeopleDirectory({ data: { status: deps.status, search: deps.q } }),
  component: PeoplePage,
})

const FILTERS = [
  { id: undefined, label: 'Everyone' },
  { id: 'approved' as const, label: 'Approved' },
  { id: 'pending' as const, label: 'Pending' },
  { id: 'suspended' as const, label: 'Suspended' },
]

function PeoplePage() {
  const { members, roles, permissions, currentUserId } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()

  const [query, setQuery] = useState(search.q ?? '')
  const [expanded, setExpanded] = useState<string | null>(null)

  const statusMutation = useMutation({
    mutationFn: (input: { userId: string; status: 'approved' | 'suspended' }) =>
      changeMemberStatus({ data: input }),
    onSuccess: () => router.invalidate(),
  })

  const roleMutation = useMutation({
    mutationFn: (input: { userId: string; roleId: string }) =>
      changeMemberRole({ data: input }),
    onSuccess: () => router.invalidate(),
  })

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault()
    navigate({ search: (current) => ({ ...current, q: query || undefined }) })
  }

  return (
    <div>
      <PageHeader
        title="People"
        description="Everyone who has signed in, whether their registration is pending, approved or suspended."
      />

      <ErrorNotice
        message={
          statusMutation.isError
            ? errorMessage(statusMutation.error)
            : roleMutation.isError
              ? errorMessage(roleMutation.error)
              : null
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={() =>
                navigate({
                  search: (current) => ({ ...current, status: filter.id }),
                })
              }
              className={classNames(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                search.status === filter.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <form onSubmit={applySearch} className="flex flex-1 gap-2 sm:max-w-sm">
          <input
            className="input mt-0"
            placeholder="Search name, email or Discord"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="btn-secondary shrink-0">
            Search
          </button>
        </form>
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="No one matches"
          description="Try a different search or filter."
        />
      ) : (
        <div className="space-y-3">
          {members.map((member) => {
            const isSelf = member.id === currentUserId
            const isExpanded = expanded === member.id

            return (
              <article key={member.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <Avatar
                      src={member.avatarUrl}
                      initials={`${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}` || member.email.slice(0, 2).toUpperCase()}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">
                          {[member.firstName, member.lastName]
                            .filter(Boolean)
                            .join(' ') || member.email}
                        </p>
                        <StatusBadge status={member.status} />
                        <span className="badge bg-slate-100 text-slate-700">
                          {member.roleName}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-slate-600">
                        {member.email}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {member.discordHandle ? `Discord ${member.discordHandle}` : 'No Discord handle'}
                        {member.phone ? ` · ${member.phone}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Joined {formatDate(member.createdAt)}
                        {member.approvedAt
                          ? ` · approved ${formatDate(member.approvedAt)}`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-2xl font-bold text-slate-900">
                      {formatHours(member.totalMinutes)}
                    </p>
                    <p className="text-xs text-slate-500">approved hours</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  {permissions.mayViewRecords ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setExpanded(isExpanded ? null : member.id)}
                    >
                      {isExpanded ? 'Hide record' : 'View record'}
                    </button>
                  ) : null}

                  {permissions.mayAssignRoles && !isSelf ? (
                    <select
                      className="input mt-0 w-auto py-2"
                      value={member.roleId}
                      disabled={roleMutation.isPending}
                      onChange={(event) =>
                        roleMutation.mutate({
                          userId: member.id,
                          roleId: event.target.value,
                        })
                      }
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {permissions.mayManage && !isSelf && member.status !== 'pending' ? (
                    member.status === 'suspended' ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={statusMutation.isPending}
                        onClick={() =>
                          statusMutation.mutate({
                            userId: member.id,
                            status: 'approved',
                          })
                        }
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={statusMutation.isPending}
                        onClick={() =>
                          statusMutation.mutate({
                            userId: member.id,
                            status: 'suspended',
                          })
                        }
                      >
                        Suspend
                      </button>
                    )
                  ) : null}

                  {member.status === 'pending' ? (
                    <span className="text-sm text-slate-500">
                      Decide this member from the review queue.
                    </span>
                  ) : null}
                </div>

                {isExpanded ? (
                  <MemberRecord
                    userId={member.id}
                    memberName={
                      [member.firstName, member.lastName].filter(Boolean).join(' ') ||
                      member.email
                    }
                    mayAdjust={permissions.mayAdjustHours}
                  />
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MemberRecord({
  userId,
  memberName,
  mayAdjust,
}: {
  userId: string
  memberName: string
  mayAdjust: boolean
}) {
  const router = useRouter()
  const [hours, setHours] = useState('')
  const [reason, setReason] = useState('')

  const record = useQuery({
    queryKey: ['member-record', userId],
    queryFn: () => fetchMemberRecord({ data: { userId } }),
  })

  const adjustment = useMutation({
    mutationFn: () =>
      postAdjustment({
        data: { userId, hours: Number(hours), reason },
      }),
    onSuccess: async () => {
      setHours('')
      setReason('')
      await record.refetch()
      router.invalidate()
    },
  })

  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-4">
      {record.isLoading ? (
        <p className="text-sm text-slate-500">Loading record…</p>
      ) : record.isError ? (
        <ErrorNotice message={errorMessage(record.error)} />
      ) : record.data ? (
        <>
          <p className="text-sm font-semibold text-slate-900">
            Hour ledger · {formatHours(record.data.totalMinutes)} hours total
          </p>

          {record.data.ledger.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No entries yet for {memberName}.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 text-sm">
              {record.data.ledger.map((entry) => (
                <li key={entry.id} className="flex justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">
                      {entry.activity ?? entry.reason ?? 'Adjustment'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {entry.serviceDate
                        ? formatDate(entry.serviceDate)
                        : formatDateTime(entry.createdAt)}
                      {entry.postedByName ? ` · by ${entry.postedByName}` : ''}
                      {entry.verificationId ? ` · ${entry.verificationId}` : ''}
                    </p>
                  </div>
                  <span
                    className={
                      entry.minutes < 0
                        ? 'shrink-0 font-semibold text-red-600'
                        : 'shrink-0 font-semibold text-slate-900'
                    }
                  >
                    {entry.minutes < 0 ? '−' : '+'}
                    {formatHours(Math.abs(entry.minutes))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {mayAdjust ? (
            <form
              className="mt-4 border-t border-slate-200 pt-4"
              onSubmit={(event) => {
                event.preventDefault()
                adjustment.mutate()
              }}
            >
              <p className="text-sm font-semibold text-slate-900">
                Post a correction
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Awarded hours are never edited. A correction is added as its own
                ledger entry, and the member is emailed.
              </p>

              <ErrorNotice
                message={adjustment.isError ? errorMessage(adjustment.error) : null}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="number"
                  step="0.25"
                  className="input mt-0 w-32"
                  placeholder="-1.5"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                  required
                />
                <input
                  className="input mt-0 flex-1"
                  placeholder="Reason for the correction"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={5}
                />
                <button
                  type="submit"
                  className="btn-secondary shrink-0"
                  disabled={adjustment.isPending}
                >
                  {adjustment.isPending ? 'Posting…' : 'Post correction'}
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
