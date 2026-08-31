import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { formatHours } from '~/lib/hours'
import {
  Avatar,
  EmptyState,
  ErrorNotice,
  PageHeader,
  classNames,
  errorMessage,
  formatDate,
  formatDateTime,
} from '~/components/ui'
import { fetchReviewQueue } from '~/server/functions/requests'
import { decideRegistration } from '~/server/functions/members'

export const Route = createFileRoute('/_app/admin/')({
  loader: () => fetchReviewQueue(),
  component: ReviewQueuePage,
})

type Tab = 'requests' | 'registrations'

function ReviewQueuePage() {
  const { pendingRequests, pendingApplications, canReviewRequests, canReviewMembers } =
    Route.useLoaderData()

  const [tab, setTab] = useState<Tab>(
    canReviewRequests ? 'requests' : 'registrations',
  )

  const tabs: Array<{ id: Tab; label: string; count: number; visible: boolean }> = [
    {
      id: 'requests',
      label: 'Hour requests',
      count: pendingRequests.length,
      visible: canReviewRequests,
    },
    {
      id: 'registrations',
      label: 'Registrations',
      count: pendingApplications.length,
      visible: canReviewMembers,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Review queue"
        description="Everything waiting on an administrator, in one place."
      />

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs
          .filter((entry) => entry.visible)
          .map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={classNames(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition',
                tab === entry.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {entry.label}
              <span
                className={classNames(
                  'ml-2 rounded-full px-2 py-0.5 text-xs',
                  entry.count > 0
                    ? 'bg-brand-100 text-brand-700'
                    : 'bg-slate-100 text-slate-500',
                )}
              >
                {entry.count}
              </span>
            </button>
          ))}
      </div>

      {tab === 'requests' ? (
        <RequestQueue requests={pendingRequests} />
      ) : (
        <RegistrationQueue applications={pendingApplications} />
      )}
    </div>
  )
}

function RequestQueue({
  requests,
}: {
  requests: Awaited<ReturnType<typeof fetchReviewQueue>>['pendingRequests']
}) {
  if (requests.length === 0) {
    return (
      <EmptyState
        title="No hour requests waiting"
        description="When a member submits volunteer hours, they will show up here for review."
      />
    )
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <Link
          key={request.id}
          to="/admin/requests/$requestId"
          params={{ requestId: request.id }}
          className="card block p-5 transition hover:border-brand-300 hover:shadow-md"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <Avatar
                src={request.memberAvatarUrl}
                initials={request.memberName.slice(0, 2).toUpperCase()}
              />
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{request.memberName}</p>
                <p className="mt-0.5 truncate text-sm text-slate-600">
                  {request.activity}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Served {formatDate(request.serviceDate)} · submitted{' '}
                  {formatDateTime(request.createdAt)} · {request.attachments.length}{' '}
                  {request.attachments.length === 1 ? 'photo' : 'photos'}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">
                {formatHours(request.minutes)}
              </p>
              <p className="text-xs text-slate-500">hours</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}

function RegistrationQueue({
  applications,
}: {
  applications: Awaited<ReturnType<typeof fetchReviewQueue>>['pendingApplications']
}) {
  const router = useRouter()
  const [notes, setNotes] = useState<Record<string, string>>({})

  const decide = useMutation({
    mutationFn: (input: {
      applicationId: string
      decision: 'approved' | 'declined'
      decisionNote?: string
    }) => decideRegistration({ data: input }),
    onSuccess: () => router.invalidate(),
  })

  if (applications.length === 0) {
    return (
      <EmptyState
        title="No registrations waiting"
        description="New members appear here after they submit their details."
      />
    )
  }

  return (
    <div className="space-y-3">
      <ErrorNotice message={decide.isError ? errorMessage(decide.error) : null} />

      {applications.map((application) => (
        <article key={application.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <Avatar
                src={application.avatarUrl}
                initials={`${application.firstName[0] ?? ''}${application.lastName[0] ?? ''}`}
              />
              <div>
                <p className="font-semibold text-slate-900">
                  {application.firstName} {application.lastName}
                </p>
                <p className="text-sm text-slate-600">{application.email}</p>
                <p className="mt-1 text-sm text-slate-500">
                  Discord {application.discordHandle}
                  {application.phone ? ` · ${application.phone}` : ''}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Submitted {formatDateTime(application.createdAt)}
                </p>
              </div>
            </div>
          </div>

          <input
            className="input"
            placeholder="Optional note included in the email"
            value={notes[application.id] ?? ''}
            onChange={(event) =>
              setNotes((current) => ({
                ...current,
                [application.id]: event.target.value,
              }))
            }
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate({
                  applicationId: application.id,
                  decision: 'approved',
                  decisionNote: notes[application.id] || undefined,
                })
              }
            >
              Approve member
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate({
                  applicationId: application.id,
                  decision: 'declined',
                  decisionNote: notes[application.id] || undefined,
                })
              }
            >
              Decline
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}
