import { t } from '@potluck/i18n'
import { Button, Dialog, DialogContent, Field, toast } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { PasswordInput } from '@/features/auth/auth-parts'
import { MIN_PASSWORD } from '@/features/auth/sign-up-page'
import { useSession } from '@/lib/auth'
import { errorCode } from '@/lib/errors'
import { accountError } from './account-error'
import { changePassword, hasPassword, requestReauthentication } from './actions'
import { CodeInput } from './code-input'
import { SettingsRow } from './settings-section'

export function PasswordRow() {
  const session = useSession()
  const user = session?.user
  const [open, setOpen] = useState(false)
  if (!user?.email) return null
  const email = user.email
  const existing = hasPassword(user)
  const title = existing ? t('security.password.change') : t('security.password.set')

  return (
    <SettingsRow
      icon={<KeyRound />}
      label={t('security.password.label')}
      value={
        existing ? (
          <span aria-hidden className="text-base leading-none tracking-[0.2em]">
            ••••••••
          </span>
        ) : (
          t('security.password.setHint')
        )
      }
      action={
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {title}
        </Button>
      }
    >
      <PasswordDialog
        open={open}
        onOpenChange={setOpen}
        email={email}
        existing={existing}
        title={title}
      />
    </SettingsRow>
  )
}

type FieldId = 'current' | 'next' | 'again' | 'nonce'

function PasswordDialog({
  open,
  onOpenChange,
  email,
  existing,
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: string
  existing: boolean
  title: string
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  // Set once Supabase asks for a fresh proof (a session older than a day): the emailed code.
  const [nonce, setNonce] = useState<string | null>(null)
  const [error, setError] = useState<{ field: FieldId; text: string } | null>(null)

  function reset() {
    setCurrent('')
    setNext('')
    setAgain('')
    setNonce(null)
    setError(null)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (next.length < MIN_PASSWORD) {
      setError({ field: 'next', text: t('errors.auth.weakPassword') })
      return
    }
    if (next !== again) {
      setError({ field: 'again', text: t('security.password.mismatch') })
      return
    }
    setBusy(true)
    setError(null)
    try {
      await changePassword({
        email,
        current: existing ? current : undefined,
        next,
        nonce: nonce ?? undefined,
      })
      toast.success(t('security.password.saved'))
      reset()
      onOpenChange(false)
    } catch (failure) {
      const code = errorCode(failure)
      if (code === 'reauthentication_needed' && nonce === null) {
        try {
          await requestReauthentication()
          setNonce('')
        } catch (sendFailure) {
          setError({ field: 'next', text: accountError(sendFailure) })
        }
      } else {
        const field: FieldId =
          code === 'wrong_current_password'
            ? 'current'
            : code === 'reauthentication_not_valid'
              ? 'nonce'
              : 'next'
        setError({ field, text: accountError(failure) })
      }
    } finally {
      setBusy(false)
    }
  }

  const errorFor = (field: FieldId) => (error?.field === field ? error.text : undefined)

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy) return
        if (!value) reset()
        onOpenChange(value)
      }}
    >
      <DialogContent
        title={title}
        description={existing ? undefined : t('security.password.setHint')}
        closeLabel={t('common.close')}
        variant="auto"
      >
        <form className="grid gap-4 pt-2" onSubmit={onSubmit} noValidate>
          {/* Lets password managers file the new password under the right account. */}
          <input type="email" hidden readOnly value={email} autoComplete="username" />
          {existing && (
            <Field
              label={t('security.password.current')}
              error={errorFor('current')}
              aside={
                <Link
                  to="/forgot-password"
                  search={{ email }}
                  className="text-sm font-semibold text-mute hover:text-ink"
                >
                  {t('security.password.forgot')}
                </Link>
              }
            >
              <PasswordInput
                autoComplete="current-password"
                autoFocus
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                aria-invalid={!!errorFor('current')}
              />
            </Field>
          )}
          <Field
            label={t('security.password.next')}
            hint={t('auth.fields.passwordHint')}
            error={errorFor('next')}
          >
            <PasswordInput
              autoComplete="new-password"
              autoFocus={!existing}
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-invalid={!!errorFor('next')}
            />
          </Field>
          <Field label={t('security.password.confirm')} error={errorFor('again')}>
            <PasswordInput
              autoComplete="new-password"
              required
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              aria-invalid={!!errorFor('again')}
            />
          </Field>
          {nonce !== null && (
            <div className="grid gap-3 rounded-input bg-saffron-soft p-3" role="status">
              <p className="text-sm text-saffron-ink">
                <strong className="block">{t('security.password.reauthTitle')}</strong>
                {t('security.password.reauthBody', { email })}
              </p>
              <Field label={t('security.password.reauthCode')} error={errorFor('nonce')}>
                <CodeInput
                  autoFocus
                  value={nonce}
                  onValueChange={setNonce}
                  aria-invalid={!!errorFor('nonce')}
                />
              </Field>
            </div>
          )}
          <Button
            type="submit"
            block
            loading={busy}
            disabled={
              (existing && !current) || !next || !again || (nonce !== null && nonce.length !== 6)
            }
          >
            {t('security.password.submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
