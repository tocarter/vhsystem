import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/onboarding')({
  beforeLoad: () => {
    throw redirect({ to: '/register' })
  },
  component: () => null,
})
