import { createFileRoute } from '@tanstack/react-router'
import { formatHours } from '~/lib/hours'
import { formatDate, formatDateTime } from '~/components/ui'
import { verifyCertificate } from '~/server/functions/verify'

export const Route = createFileRoute('/verify/$verificationId')({
  loader: ({ params }) =>
    verifyCertificate({ data: { verificationId: params.verificationId } }),
  head: ({ params }) => ({
    meta: [{ title: `Verify ${params.verificationId} · Volunteer Hours` }],
  }),
  component: VerifyPage,
})

function VerifyPage() {
  const result = Route.useLoaderData()
  const { verificationId } = Route.useParams()

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      {!result.found ? (
        <div className="card p-8 text-center">
          <span className="badge bg-red-100 text-red-700">Not found</span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            No record matches this ID
          </h1>
          <p className="mt-2 text-slate-600">
            We could not find a volunteer hour certificate with the ID{' '}
            <span className="font-mono font-semibold">{verificationId}</span>.
            Check for typing mistakes, including the letter and number
            characters.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="bg-emerald-600 px-8 py-5 text-white">
            <p className="text-xs font-semibold tracking-wide uppercase opacity-90">
              {result.orgName}
            </p>
            <p className="mt-1 text-lg font-bold">
              Verified volunteer hour record
            </p>
          </div>

          <div className="px-8 py-7">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Volunteer
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {result.memberName}
            </p>

            <div className="mt-7 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {result.scope === 'award'
                    ? 'Hours on this certificate'
                    : 'Total hours certified'}
                </p>
                <p className="mt-1 text-3xl font-bold text-slate-900">
                  {formatHours(result.totalMinutes)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Current approved total
                </p>
                <p className="mt-1 text-3xl font-bold text-slate-900">
                  {formatHours(result.currentTotalMinutes)}
                </p>
              </div>
            </div>

            <dl className="mt-8 divide-y divide-slate-100 border-t border-slate-100 text-sm">
              {result.activity ? (
                <Row label="Activity" value={result.activity} />
              ) : null}
              {result.periodStart && result.periodEnd ? (
                <Row
                  label={result.scope === 'award' ? 'Service date' : 'Service period'}
                  value={
                    result.periodStart === result.periodEnd
                      ? formatDate(result.periodStart)
                      : `${formatDate(result.periodStart)} – ${formatDate(result.periodEnd)}`
                  }
                />
              ) : null}
              <Row label="Issued" value={formatDateTime(result.issuedAt)} />
              <Row label="Verification ID" value={verificationId} mono />
              <Row
                label="Membership"
                value={result.membershipActive ? 'Active' : 'Not currently active'}
              />
            </dl>

            {result.currentTotalMinutes !== result.totalMinutes &&
            result.scope === 'summary' ? (
              <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                This certificate was issued for{' '}
                {formatHours(result.totalMinutes)} hours. The member&rsquo;s
                record has changed since, and now totals{' '}
                {formatHours(result.currentTotalMinutes)} hours.
              </p>
            ) : null}

            {result.orgContactEmail ? (
              <p className="mt-6 text-sm text-slate-600">
                Questions about this record? Contact{' '}
                <a
                  className="font-medium text-brand-700 underline"
                  href={`mailto:${result.orgContactEmail}`}
                >
                  {result.orgContactEmail}
                </a>
                .
              </p>
            ) : null}
          </div>
        </div>
      )}
    </main>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-wrap justify-between gap-3 py-3">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={
          mono
            ? 'font-mono font-semibold text-slate-900'
            : 'text-right font-medium text-slate-900'
        }
      >
        {value}
      </dd>
    </div>
  )
}
