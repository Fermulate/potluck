import { createFileRoute } from '@tanstack/react-router'
import { ForgotPasswordPage } from '@/features/auth/password-pages'
import { stringParam } from '@/lib/search'

export const Route = createFileRoute('/forgot-password')({
  validateSearch: stringParam('email'),
  component: ForgotPasswordRoute,
})

function ForgotPasswordRoute() {
  const { email } = Route.useSearch()
  return <ForgotPasswordPage initialEmail={email} />
}
