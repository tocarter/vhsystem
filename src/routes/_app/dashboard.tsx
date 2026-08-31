import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { formatHours } from '~/lib/hours'
import { homeFor } from '~/lib/routing'
import {
  EmptyState,
  ErrorNotice,
  PageHeader,
  Stat,
  StatusBadge,
  errorMessage,
  formatDate,
  formatDateTime,
} from '~/components/ui'
import { PhotoStrip } from '~/components/PhotoStrip'
import { fetchMyDashboard } from '~/server/functions/requests'
import { createSummaryCertificate } from '~/server/functions/hours'

export const Route = createFileRoute('/_app/dashboard')({
  beforeLoad: ({ context }) => {
    if (context.session.status !== 'approved') {
      throw redirect({ href: homeFor(context.session) })
    }
  },
  loader: () => fetchMyDashboard(),
  component: DashboardPage,
})

function DashboardPage() {
  const { requests, ledger, totalMinutes } = Route.useLoaderData()
  const { session } = Route.useRouteContext()

  const certificate = useMutation({
    mutationFn: () => createSummaryCertificate({ data: {} }),
    onSuccess: (result) => {
      window.location.href = `/api/certificates/${result.certificateId}`
    },
  })

  const openRequests = requests.filter((request) => request.status !== 'approved')
  const awardedCount = ledger.filter((entry) => entry.kind === 'award').length
  const attachmentsByRequest = new Map(
    requests.map((request) => [request.id, request.attachments]),
  )

  return (
    <div>
      <PageHeader
        title={`Hi ${session.firstName ?? 'there'}`}
        description="Everything you have logged, and the hours an administrator has approved."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => certificate.mutate()}
              disabled={certificate.isPending || totalMinutes <= 0}
              title={
                totalMinutes <= 0
                  ? 'You need approved hours before a certificate can be issued'
                  : undefined
              }
            >
              {certificate.isPending ? 'Preparing…' : 'Download certificate'}
            </button>
            <Link to="/requests/new" className="btn-primary">
              Log hours
            </Link>
          </>
        }
      />

      <ErrorNotice
        message={certificate.isError ? errorMessage(certificate.error) : null}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Approved hours"
          value={formatHours(totalMinutes)}
          hint="Total you can show your school"
        />
        <Stat
          label="Awarded entries"
          value={String(awardedCount)}
          hint="Approved submissions"
        />
        <Stat
          label="Awaiting review"
          value={String(
            requests.filter((request) => request.status === 'pending').length,
          )}
          hint="Submitted, not yet decided"
        />
      </div>

      {openRequests.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">
            Your open submissions
          </h2>
          <div className="space-y-3">
            {openRequests.map((request) => (
              <Link
                key={request.id}
                to="/requests/$requestId"
                params={{ requestId: request.id }}
                className="card block p-5 transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {request.activity}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatDate(request.serviceDate)} ·{' '}
                      {formatHours(request.minutes)} hours requested
                    </p>
                  </div>
                  <StatusBadge status={request.status} />
                </div>
                {request.reviewNote ? (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span className="font-medium">Reviewer note:</span>{' '}
                    {request.reviewNote}
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          Your hour record
        </h2>

        {ledger.length === 0 ? (
          <EmptyState
            title="No approved hours yet"
            description="Once you submit hours and an administrator approves them, they will appear here with a certificate you can download."
            action={
              <Link to="/requests/new" className="btn-primary">
                Log your first hours
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {ledger.map((entry) => {
              const attachments = entry.requestId
                ? (attachmentsByRequest.get(entry.requestId) ?? [])
                : []

              return (
                <article key={entry.id} className="card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={entry.kind} />
                        <span className="text-sm text-slate-500">
                          {entry.serviceDate
                            ? formatDate(entry.serviceDate)
                            : formatDateTime(entry.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 font-semibold text-slate-900">
                        {entry.activity ?? entry.reason ?? 'Manual adjustment'}
                      </p>
                      {entry.postedByName ? (
                        <p className="mt-1 text-sm text-slate-500">
                          Recorded by {entry.postedByName}
                        </p>
                      ) : null}
                    </div>

                    <div className="text-right">
                      <p
                        className={
                          entry.minutes < 0
                            ? 'text-2xl font-bold text-red-600'
                            : 'text-2xl font-bold text-slate-900'
                        }
                      >
                        {entry.minutes < 0 ? '−' : '+'}
                        {formatHours(Math.abs(entry.minutes))}
                      </p>
                      <p className="text-xs text-slate-500">hours</p>
                    </div>
                  </div>

                  {attachments.length > 0 ? (
                    <PhotoStrip attachments={attachments} className="mt-4" />
                  ) : null}

                  {entry.certificateId ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                      <a
                        href={`/api/certificates/${entry.certificateId}`}
                        className="btn-secondary"
                      >
                        Download certificate
                      </a>
                      <span className="font-mono text-xs text-slate-500">
                        {entry.verificationId}
                      </span>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
