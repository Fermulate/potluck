import { recoverWithCode } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, Field, Input, toast } from '@potluck/ui'
import { useNavigate } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { accountError } from '@/features/account/account-error'
import { verifiedTotp, verifyTotp } from '@/features/account/actions'
import { CodeInput } from '@/features/account/code-input'
import { signOut } from '@/lib/auth'
import { errorCode } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from './auth-layout'

type Mode = 'app' | 'recovery'

/**
 * The second step of signing in: a code from the authenticator app, or one of the saved
 * recovery codes when the phone is gone (which switches two-step sign in off).
 */
export function TwoFactorPage({ redirect }: { redirect: string }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('app')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = mode === 'app' ? code.length === 6 : code.replace(/[^a-z0-9]/gi, '').length >= 10

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'app') {
        const factor = await verifiedTotp()
        if (factor) await verifyTotp(factor.id, code)
      } else {
        await recoverWithCode(supabase, code)
        const { error: refreshError } = await supabase.auth.refreshSession()
        if (refreshError) throw refreshError
        toast.success(t('security.challenge.recovered'))
      }
      await navigate({ href: redirect, replace: true })
    } catch (failure) {
      setError(
        mode === 'recovery' && errorCode(failure) === 'invalid_recovery_code'
          ? t('security.challenge.wrongRecovery')
          : accountError(failure),
      )
      setCode('')
      setBusy(false)
    }
  }

  function switchMode() {
    setMode((m) => (m === 'app' ? 'recovery' : 'app'))
    setCode('')
    setError(null)
  }

  return (
    <AuthLayout
      title={t('security.challenge.title')}
      subtitle={
        mode === 'app' ? t('security.challenge.body') : t('security.challenge.recoveryBody')
      }
      footer={
        <button
          type="button"
          className="font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4"
          onClick={async () => {
            await signOut()
            await navigate({ to: '/sign-in', search: { redirect }, replace: true })
          }}
        >
          {t('security.challenge.signOut')}
        </button>
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {mode === 'app' ? (
          <Field label={t('security.twoFactor.code')} error={error}>
            <CodeInput autoFocus value={code} onValueChange={setCode} aria-invalid={!!error} />
          </Field>
        ) : (
          <Field label={t('security.challenge.recoveryCode')} error={error}>
            <Input
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={32}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('security.challenge.recoveryPlaceholder')}
              aria-invalid={!!error}
              className="h-14 text-center text-xl font-bold tracking-[0.2em] uppercase tabular-nums"
            />
          </Field>
        )}
        <Button
          type="submit"
          size="lg"
          block
          loading={busy}
          disabled={!ready}
          leadingIcon={<ShieldCheck />}
        >
          {t('security.challenge.submit')}
        </Button>
        <Button variant="ghost" block onClick={switchMode}>
          {mode === 'app' ? t('security.challenge.useRecovery') : t('security.challenge.useApp')}
        </Button>
      </form>
    </AuthLayout>
  )
}
