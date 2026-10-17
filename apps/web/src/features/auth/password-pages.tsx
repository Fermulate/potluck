import { Link, useNavigate } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { Button, Field, Input, toast } from '@potluck/ui'
import { useState, type FormEvent } from 'react'
import { authCallbackUrl, useSession } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from './auth-layout'
import { PasswordInput } from './auth-parts'
import { MIN_PASSWORD } from './sign-up-page'

const backLink = (
  <Link to="/sign-in" className="font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4">
    {t('auth.forgotPassword.back')}
  </Link>
)

export function ForgotPasswordPage({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authCallbackUrl('/reset-password'),
      })
      if (error) throw error
      setSent(true)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={t('auth.forgotPassword.title')}
      subtitle={sent ? undefined : t('auth.forgotPassword.body')}
      footer={backLink}
    >
      {sent ? (
        <p className="text-lg" role="status">
          {t('auth.forgotPassword.sent')}
        </p>
      ) : (
        <form className="grid gap-4" onSubmit={onSubmit}>
          <Field label={t('auth.fields.email')}>
            <Input
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.fields.emailPlaceholder')}
            />
          </Field>
          <Button type="submit" size="lg" block loading={busy}>
            {t('auth.forgotPassword.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

/** Reached from the recovery email via `/auth/callback`, which signs the person in first. */
export function ResetPasswordPage() {
  const session = useSession()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < MIN_PASSWORD) {
      toast.error(t('errors.auth.weakPassword'))
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      toast.success(t('auth.resetPassword.done'))
      await navigate({ to: '/home', replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (!session) {
    return (
      <AuthLayout title={t('auth.resetPassword.title')} footer={backLink}>
        <p className="text-lg">{t('auth.resetPassword.expired')}</p>
        <Button asChild variant="secondary">
          <Link to="/forgot-password">{t('auth.forgotPassword.submit')}</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.resetPassword.title')}>
      <form className="grid gap-4" onSubmit={onSubmit}>
        <Field label={t('auth.fields.newPassword')} hint={t('auth.fields.passwordHint')}>
          <PasswordInput
            autoComplete="new-password"
            required
            autoFocus
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" block loading={busy}>
          {t('auth.resetPassword.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
