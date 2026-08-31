import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { can } from '~/lib/permissions'
import { homeFor } from '~/lib/routing'
import { PageHeader, errorMessage } from '~/components/ui'
import { RequestForm } from '~/components/RequestForm'
import { submitVolunteerRequest } from '~/server/functions/requests'

export const Route = createFileRoute('/_app/requests/new')({
  beforeLoad: ({ context }) => {
    const { session } = context
    if (session.status !== 'approved') {
      throw redirect({ href: homeFor(session) })
    }
    if (
      !can(
        { id: session.id, status: session.status, permissions: session.permissions },
        'requests.submit',
      )
    ) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: NewRequestPage,
})

function NewRequestPage() {
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: (formData: FormData) => submitVolunteerRequest({ data: formData }),
    onSuccess: async () => {
      await router.invalidate()
      router.navigate({ to: '/dashboard' })
    },
  })

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Log volunteer hours"
        description="Tell us what you did and attach proof. An administrator reviews every submission before the hours are added to your record."
      />
      <RequestForm
        submitLabel="Submit for review"
        pending={mutation.isPending}
        errorText={mutation.isError ? errorMessage(mutation.error) : null}
        onSubmit={(formData) => mutation.mutate(formData)}
      />
    </div>
  )
}
