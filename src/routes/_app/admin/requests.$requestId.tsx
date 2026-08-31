import { useState } from 'react'
import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { can } from '~/lib/permissions'
import { formatHours, minutesToHours } from '~/lib/hours'
import {
  Avatar,
  ErrorNotice,
  Field,
  PageHeader,
  StatusBadge,
  errorMessage,
  formatDate,
  formatDateTime,
} from '~/components/ui'
import { PhotoStrip } from '~/components/PhotoStrip'
import {
  decideVolunteerRequest,
  fetchRequestForReview,
} from '~/server/functions/requests'

export const Route = createFileRoute('/_app/admin/requests/$requestId')({
  beforeLoad: ({ context }) => {
    if (!can(context.viewer, 'requests.view_all')) {
      throw redirect({ to: '/admin' })
    }
  },
  loader: ({ params }) =>
    fetchRequestForReview({ data: { requestId: params.requestId } }),
  component: ReviewRequestPage,
})

function ReviewRequestPage() {
  const { request, duplicates, memberTotalMinutes } = Route.useLoaderData()
  const { viewer } = Route.useRouteContext()
  const router = useRouter()

  const [reviewNote, setReviewNote] = useState('')
  const [awardHours, setAwardHours] = useState(
    String(minutesToHours(request.minutes)),
  )
  const [confirming, setConfirming] = useState<null | 'approved' | 'declined' | 'changes_requested'>(
    null,
  )

  const canReview = can(viewer, 'requests.review')
  const isOwnRequest = request.userId === viewer.id
  const alreadyDecided = request.status === 'approved'

  const decide = useMutation({
    mutationFn: (input: {
      decision: 'approved' | 'declined' | 'changes_requested'
      approvedHours?: number
    }) =>
      decideVolunteerRequest({
        data: {
          requestId: request.id,
          decision: input.decision,
          reviewNote: reviewNote || undefined,
          approvedHours: input.approvedHours,
        },
      }),
    onSuccess: async () => {
      setConfirming(null)
      await router.invalidate()
      router.navigate({ to: '/admin' })
    },
  })

  const parsedHours = Number(awardHours)
  const hoursDiffer =
    Number.isFinite(parsedHours) && parsedHours !== minutesToHours(request.minutes)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Review volunteer hours"
        description={
          <Link to="/admin" className="text-brand-700 underline">
            Back to the review queue
          </Link>
        }
        actions={<StatusBadge status={request.status} />}
      />

      <article className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <Avatar
              src={request.memberAvatarUrl}
              initials={request.memberName.slice(0, 2).toUpperCase()}
              size={48}
            />
            <div>
              <p className="text-lg font-semibold text-slate-900">
                {request.memberName}
              </p>
              <p className="text-sm text-slate-600">{request.memberEmail}</p>
              <p className="mt-1 text-sm text-slate-500">
                {formatHours(memberTotalMinutes)} hours approved to date
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-slate-900">
              {formatHours(request.minutes)}
            </p>
            <p className="text-xs text-slate-500">hours requested</p>
          </div>
        </div>

        <dl className="mt-6 divide-y divide-slate-100 border-y border-slate-100 text-sm">
          <Row label="Service date" value={formatDate(request.serviceDate)} />
          <Row label="Submitted" value={formatDateTime(request.createdAt)} />
          {request.reviewerName ? (
            <Row label="Last reviewed by" value={request.reviewerName} />
          ) : null}
        </dl>

        <div className="mt-6">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Activity
          </p>
          <p className="mt-1.5 whitespace-pre-line text-slate-800">
            {request.activity}
          </p>
        </div>

        {request.notes ? (
          <div className="mt-5">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Member notes
            </p>
            <p className="mt-1.5 whitespace-pre-line text-slate-700">
              {request.notes}
            </p>
          </div>
        ) : null}

        {request.attachments.length > 0 ? (
          <PhotoStrip attachments={request.attachments} className="mt-6" />
        ) : (
          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No proof photos were attached to this submission.
          </p>
        )}
      </article>

      {duplicates.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            Possible duplicate
          </p>
          <p className="mt-1 text-sm text-amber-900">
            This member has {duplicates.length} other{' '}
            {duplicates.length === 1 ? 'submission' : 'submissions'} for{' '}
            {formatDate(request.serviceDate)}. Check you are not crediting the same
            shift twice.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {duplicates.map((duplicate) => (
              <li key={duplicate.id}>
                · {duplicate.activity} ({formatHours(duplicate.minutes)} hours,{' '}
                {duplicate.status})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!canReview ? (
        <p className="mt-6 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
          You can view this request but do not have permission to decide it.
        </p>
      ) : alreadyDecided ? (
        <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          These hours were already awarded. Post an adjustment from the member&rsquo;s
          record if a correction is needed.
        </p>
      ) : isOwnRequest ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You cannot review your own submission. Ask another administrator.
        </p>
      ) : (
        <section className="card mt-6 p-6">
          <h2 className="text-base font-semibold text-slate-900">Decision</h2>

          <ErrorNotice
            message={decide.isError ? errorMessage(decide.error) : null}
          />

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field
              label="Hours to award"
              hint="Change this to award fewer hours than requested."
            >
              <input
                type="number"
                className="input"
                min="0.25"
                step="0.25"
                value={awardHours}
                onChange={(event) => setAwardHours(event.target.value)}
              />
            </Field>
          </div>

          <div className="mt-5">
            <Field
              label="Note to the member"
              hint="Included in the email. Required when asking for changes."
            >
              <textarea
                className="input min-h-20 resize-y"
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
              />
            </Field>
          </div>

          {confirming === 'approved' ? (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-900">
                Award <strong>{formatHours(Math.round(parsedHours * 60))}</strong>{' '}
                hours to {request.memberName}? This adds a permanent entry to their
                record and emails them right away.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate({
                      decision: 'approved',
                      approvedHours: hoursDiffer ? parsedHours : undefined,
                    })
                  }
                >
                  {decide.isPending ? 'Awarding…' : 'Yes, award the hours'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={!Number.isFinite(parsedHours) || parsedHours <= 0}
                onClick={() => setConfirming('approved')}
              >
                Approve and award
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={decide.isPending || reviewNote.trim().length === 0}
                title={
                  reviewNote.trim().length === 0
                    ? 'Add a note explaining what to change'
                    : undefined
                }
                onClick={() => decide.mutate({ decision: 'changes_requested' })}
              >
                Ask for changes
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ decision: 'declined' })}
              >
                Decline
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  )
}
