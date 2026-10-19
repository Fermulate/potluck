import { Link, useNavigate } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { Button, Field, Input, toast } from '@potluck/ui'
import { useState, type FormEvent } from 'react'
import { authCallbackUrl, safeRedirect } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { detectTimezone } from '@/lib/locale'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from './auth-layout'
import { CheckEmail, OAuthButtons, PasswordInput } from './auth-parts'
import type { AuthPageProps } from './sign-in-page'

export const MIN_PASSWORD = 8

export function SignUpPage({ redirect, notice }: AuthPageProps) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const target = safeRedirect(redirect)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < MIN_PASSWORD) {
      toast.error(t('errors.auth.weakPassword'))
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: authCallbackUrl(target),
          data: {
            display_name: name.trim(),
            timezone: detectTimezone(),
          },
        },
      })
      if (error) throw error
      if (data.session) {
        await navigate({ to: '/welcome', search: { redirect: target }, replace: true })
      } else {
        setSent(true)
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthLayout title={t('auth.checkEmail.title')}>
        <CheckEmail
          email={email}
          onResend={async () => {
            const { error } = await supabase.auth.resend({
              type: 'signup',
              email,
              options: { emailRedirectTo: authCallbackUrl(target) },
            })
            if (error) throw error
          }}
          onBack={() => setSent(false)}
        />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t('auth.signUp.title')}
      subtitle={t('auth.signUp.subtitle')}
      notice={notice}
      footer={
        <div className="grid gap-3">
          <p>
            {t('auth.signUp.haveAccount')}{' '}
            <Link
              to="/sign-in"
              search={{ redirect }}
              className="font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4"
            >
              {t('auth.signUp.signInLink')}
            </Link>
          </p>
          <p className="text-xs">{t('auth.signUp.terms')}</p>
        </div>
      }
    >
      <OAuthButtons redirect={target} />
      <form className="grid gap-4" onSubmit={onSubmit}>
        <Field label={t('auth.fields.name')}>
          <Input
            autoComplete="name"
            required
            autoFocus
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('auth.fields.namePlaceholder')}
          />
        </Field>
        <Field label={t('auth.fields.email')}>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.fields.emailPlaceholder')}
          />
        </Field>
        <Field label={t('auth.fields.password')} hint={t('auth.fields.passwordHint')}>
          <PasswordInput
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" block loading={busy}>
          {t('auth.signUp.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
