import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { GoogleMark } from '~/components/RegistrationForm'
import { destinationAfterLogin, safeRedirectPath } from '~/lib/routing'

const searchSchema = z.object({
  redirect: z.string().optional(),
  error: z.string().optional(),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({
        href: destinationAfterLogin(context.session, search.redirect),
      })
    }
  },
  component: LandingPage,
})

function LandingPage() {
  const { redirect: redirectTo, error } = Route.useSearch()
  const signInHref = redirectTo
    ? `/api/auth/google/start?redirect=${encodeURIComponent(safeRedirectPath(redirectTo) ?? '')}`
    : '/api/auth/google/start'

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      <section className="flex flex-1 items-center justify-center px-6 py-16 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
              V
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">
              Volunteer Hours System
            </span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Sign in to continue
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
            Every visit starts with Google. After you sign in, what you can do
            depends on your role — members log hours, administrators review
            them. New accounts are sent to registration.
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          ) : null}

          <a href={signInHref} className="btn-secondary mt-8 w-full py-3 text-base">
            <GoogleMark />
            Continue with Google
          </a>

          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Use the Google account you check most often. Approval notices and
            hour confirmations are emailed to that address.
          </p>
        </div>
      </section>

      <section className="hidden flex-1 bg-slate-900 px-10 py-16 lg:flex lg:items-center">
        <div className="max-w-md text-slate-300">
          <h2 className="text-sm font-semibold tracking-wide text-brand-100 uppercase">
            How it works
          </h2>
          <ol className="mt-8 space-y-7">
            {[
              {
                title: 'Sign in with Google',
                body: 'Everyone starts here. We match your Google account to a member record.',
              },
              {
                title: 'Register if you are new',
                body: 'If we do not recognise the account, you fill in your name and Discord handle for review.',
              },
              {
                title: 'Use the pages your role allows',
                body: 'Members log hours. Administrators review registrations, requests, people and roles.',
              },
              {
                title: 'Show your school',
                body: 'Download a certificate with a verification ID your school can check independently.',
              },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {index + 1}
                </span>
                <div>
                  <p className="font-semibold text-white">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  )
}
