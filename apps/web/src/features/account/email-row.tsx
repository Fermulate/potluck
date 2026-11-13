import { t } from '@potluck/i18n'
import { Button, Dialog, DialogContent, Field, Input, toast } from '@potluck/ui'
import { AtSign, MailCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSession } from '@/lib/auth'
import { accountError } from './account-error'
import { cancelPendingEmail, changeEmail } from './actions'
import { SettingsRow } from './settings-section'

export function EmailRow() {
  const session = useSession()
  const user = session?.user
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  if (!user?.email) return null
  const current = user.email
  const pending = user.new_email

  async function onCancel() {
    setCancelling(true)
    try {
      await cancelPendingEmail()
      toast.success(t('security.email.cancelled', { email: current }))
    } catch (failure) {
      toast.error(accountError(failure))
    } finally {
      setCancelling(false)
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next = email.trim()
    if (next.toLowerCase() === current.toLowerCase()) {
      setError(t('security.email.same'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await changeEmail(next)
      toast.success(t('security.email.sent'))
      setOpen(false)
      setEmail('')
    } catch (failure) {
      setError(accountError(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsRow
      icon={<AtSign />}
      label={t('security.email.label')}
      value={current}
      action={
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t('security.email.change')}
        </Button>
      }
    >
      {pending && (
        <div className="grid gap-2 rounded-input bg-saffron-soft px-3 py-2.5 text-sm text-saffron-ink">
          <p role="status" className="flex items-start gap-2">
            <MailCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('security.email.pending', { email: pending })}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="justify-self-start"
            loading={cancelling}
            onClick={onCancel}
          >
            {t('security.email.cancel')}
          </Button>
        </div>
      )}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent
          title={t('security.email.change')}
          description={t('security.email.hint')}
          closeLabel={t('common.close')}
          variant="auto"
        >
          <form className="grid gap-4 pt-2" onSubmit={onSubmit} noValidate>
            <Field label={t('security.email.newEmail')} error={error}>
              <Input
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.fields.emailPlaceholder')}
                aria-invalid={!!error}
              />
            </Field>
            <Button type="submit" block loading={busy} disabled={!email.includes('@')}>
              {t('security.email.submit')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsRow>
  )
}
