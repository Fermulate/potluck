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
import { changePassword, hasPassword } from './actions'
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
  const [error, setError] = useState<{ field: 'current' | 'next' | 'again'; text: string } | null>(
    null,
  )

  function reset() {
    setCurrent('')
    setNext('')
    setAgain('')
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
      await changePassword({ email, current: existing ? current : undefined, next })
      toast.success(t('security.password.saved'))
      reset()
      onOpenChange(false)
    } catch (failure) {
      const wrong = errorCode(failure) === 'wrong_current_password'
      setError({ field: wrong ? 'current' : 'next', text: accountError(failure) })
    } finally {
      setBusy(false)
    }
  }

  const errorFor = (field: 'current' | 'next' | 'again') =>
    error?.field === field ? error.text : undefined

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
          <Button
            type="submit"
            block
            loading={busy}
            disabled={(existing && !current) || !next || !again}
          >
            {t('security.password.submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
