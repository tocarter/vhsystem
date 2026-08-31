import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/pending')({
  beforeLoad: ({ context }) => {
    const { session } = context
    if (session.status === 'suspended') throw redirect({ to: '/suspended' })
    if (session.status === 'approved') throw redirect({ to: '/dashboard' })
    if (!session.hasSubmittedApplication) throw redirect({ to: '/register' })
  },
  component: PendingPage,
})

function PendingPage() {
  const { session } = Route.useRouteContext()

  return (
    <div className="mx-auto max-w-xl">
      <div className="card p-8 text-center">
        <span className="badge bg-amber-100 text-amber-800">Awaiting review</span>

        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          Your registration is with an administrator
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
          Once it is approved you will be able to submit volunteer hours. We will
          email <span className="font-medium text-slate-900">{session.email}</span>{' '}
          as soon as there is a decision.
        </p>

        <dl className="mt-8 divide-y divide-slate-100 border-t border-slate-100 text-left text-sm">
          <Row label="Name" value={`${session.firstName ?? ''} ${session.lastName ?? ''}`.trim() || '—'} />
          <Row label="Discord" value={session.discordHandle ?? '—'} />
          <Row label="Phone" value={session.phone || 'Not provided'} />
        </dl>
      </div>
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
