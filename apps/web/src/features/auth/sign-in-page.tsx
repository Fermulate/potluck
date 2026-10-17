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

export interface AuthPageProps {
  redirect?: string
  /** Shown above the form, e.g. "Sign in to join Hike crew". */
  notice?: string
}

type Mode = 'password' | 'magic' | 'sent'

export function SignInPage({ redirect, notice }: AuthPageProps) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const target = safeRedirect(redirect)

  const sendLink = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authCallbackUrl(target),
        data: { needs_onboarding: true, timezone: detectTimezone() },
      },
    })
    if (error) throw error
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      if (mode === 'magic') {
        await sendLink()
        setMode('sent')
        return
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      await navigate({ href: target, replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'sent') {
    return (
      <AuthLayout title={t('auth.checkEmail.title')}>
        <CheckEmail email={email} onResend={sendLink} onBack={() => setMode('magic')} />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t('auth.signIn.title')}
      subtitle={t('auth.signIn.subtitle')}
      notice={notice}
      footer={
        <p>
          {t('auth.signIn.noAccount')}{' '}
          <Link
            to="/sign-up"
            search={{ redirect }}
            className="font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4"
          >
            {t('auth.signIn.createAccount')}
          </Link>
        </p>
      }
    >
      <OAuthButtons redirect={target} />
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
        {mode === 'password' && (
          <Field
            label={t('auth.fields.password')}
            aside={
              <Link
                to="/forgot-password"
                search={{ email: email || undefined }}
                className="text-sm font-semibold text-mute hover:text-ink"
              >
                {t('auth.forgotPassword.link')}
              </Link>
            }
          >
            <PasswordInput
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        <Button type="submit" size="lg" block loading={busy}>
          {mode === 'magic' ? t('auth.signIn.magicLink') : t('auth.signIn.submit')}
        </Button>
        <Button
          variant="ghost"
          block
          onClick={() => setMode((m) => (m === 'magic' ? 'password' : 'magic'))}
        >
          {mode === 'magic' ? t('auth.signIn.usePassword') : t('auth.signIn.magicLink')}
        </Button>
      </form>
    </AuthLayout>
  )
}
