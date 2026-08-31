import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import {
  RegistrationForm,
  type RegistrationFormState,
} from '~/components/RegistrationForm'
import { submitRegistration } from '~/server/functions/members'

export const Route = createFileRoute('/_app/register')({
  beforeLoad: ({ context }) => {
    const { session } = context
    if (session.status === 'suspended') throw redirect({ to: '/suspended' })
    if (session.status === 'approved') throw redirect({ to: '/dashboard' })
    if (session.hasSubmittedApplication) throw redirect({ to: '/pending' })
  },
  component: RegisterPage,
})

function RegisterPage() {
  const { session } = Route.useRouteContext()
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: (data: RegistrationFormState) => submitRegistration({ data }),
    onSuccess: async () => {
      await router.invalidate()
      router.navigate({ to: '/pending' })
    },
  })

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">
        Complete your registration
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
        We do not have a member record for this Google account yet. Tell us who
        you are and an administrator will review it. Your role and pages unlock
        after approval.
      </p>

      <div className="card mt-8 p-6">
        <RegistrationForm
          email={session.email}
          initial={{
            firstName: session.firstName ?? '',
            lastName: session.lastName ?? '',
            discordHandle: session.discordHandle ?? '',
            phone: session.phone ?? '',
          }}
          submitting={mutation.isPending}
          error={mutation.error}
          submitLabel="Submit for review"
          onSubmit={(data) => mutation.mutate(data)}
        />
      </div>
    </div>
  )
}
