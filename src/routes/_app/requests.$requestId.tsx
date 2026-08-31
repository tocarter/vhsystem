import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { formatHours, minutesToHours } from '~/lib/hours'
import {
  PageHeader,
  StatusBadge,
  errorMessage,
  formatDate,
  formatDateTime,
} from '~/components/ui'
import { PhotoStrip } from '~/components/PhotoStrip'
import { RequestForm } from '~/components/RequestForm'
import {
  fetchMyRequest,
  updateVolunteerRequest,
} from '~/server/functions/requests'

export const Route = createFileRoute('/_app/requests/$requestId')({
  loader: ({ params }) => fetchMyRequest({ data: { requestId: params.requestId } }),
  component: RequestDetailPage,
})

function RequestDetailPage() {
  const request = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  const isOwner = request.userId === session.id
  const canEdit =
    isOwner &&
    (request.status === 'pending' || request.status === 'changes_requested')

  const mutation = useMutation({
    mutationFn: (formData: FormData) => {
      formData.set('requestId', request.id)
      return updateVolunteerRequest({ data: formData })
    },
    onSuccess: async () => {
      setEditing(false)
      await router.invalidate()
    },
  })

  if (editing) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Update your submission"
          description="Resubmitting puts this request back at the front of the review queue."
          actions={
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          }
        />
        <RequestForm
          initialValues={{
            serviceDate: request.serviceDate,
            activity: request.activity,
            hours: String(minutesToHours(request.minutes)),
            notes: request.notes ?? '',
          }}
          existingAttachments={request.attachments}
          submitLabel="Resubmit for review"
          pending={mutation.isPending}
          errorText={mutation.isError ? errorMessage(mutation.error) : null}
          onSubmit={(formData) => mutation.mutate(formData)}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Volunteer hour request"
        description={
          <Link to="/dashboard" className="text-brand-700 underline">
            Back to my hours
          </Link>
        }
        actions={
          canEdit ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setEditing(true)}
            >
              Edit and resubmit
            </button>
          ) : undefined
        }
      />

      <article className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <StatusBadge status={request.status} />
            <p className="mt-3 text-lg font-semibold text-slate-900">
              {request.activity}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Served on {formatDate(request.serviceDate)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-slate-900">
              {formatHours(request.awardedMinutes ?? request.minutes)}
            </p>
            <p className="text-xs text-slate-500">
              {request.awardedMinutes === null ? 'hours requested' : 'hours awarded'}
            </p>
          </div>
        </div>

        {request.awardedMinutes !== null &&
        request.awardedMinutes !== request.minutes ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            You requested {formatHours(request.minutes)} hours and the reviewer
            awarded {formatHours(request.awardedMinutes)}.
          </p>
        ) : null}

        {request.notes ? (
          <div className="mt-5">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Your notes
            </p>
            <p className="mt-1.5 text-sm whitespace-pre-line text-slate-700">
              {request.notes}
            </p>
          </div>
        ) : null}

        {request.reviewNote ? (
          <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Reviewer note
            </p>
            <p className="mt-1.5 text-sm whitespace-pre-line text-slate-700">
              {request.reviewNote}
            </p>
          </div>
        ) : null}

        <PhotoStrip attachments={request.attachments} className="mt-6" />

        <dl className="mt-6 divide-y divide-slate-100 border-t border-slate-100 text-sm">
          <Row label="Submitted" value={formatDateTime(request.createdAt)} />
          {request.decidedAt ? (
            <Row label="Decided" value={formatDateTime(request.decidedAt)} />
          ) : null}
          {request.reviewerName ? (
            <Row label="Reviewed by" value={request.reviewerName} />
          ) : null}
        </dl>
      </article>
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
