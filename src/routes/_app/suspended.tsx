import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/suspended')({
  beforeLoad: ({ context }) => {
    if (context.session.status !== 'suspended') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: SuspendedPage,
})

function SuspendedPage() {
  return (
    <div className="mx-auto max-w-xl">
      <div className="card p-8 text-center">
        <span className="badge bg-slate-200 text-slate-700">Suspended</span>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          Your membership is paused
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
          You cannot submit or view volunteer hours while your membership is
          suspended. Your existing hour record is preserved. Speak to an
          administrator if you think this is a mistake.
        </p>
      </div>
    </div>
  )
}
