import { createFileRoute } from '@tanstack/react-router'
import { ResetPasswordPage } from '@/features/auth/password-pages'
import { getSession } from '@/lib/auth'

export const Route = createFileRoute('/reset-password')({
  beforeLoad: async () => {
    await getSession()
  },
  component: ResetPasswordPage,
})
