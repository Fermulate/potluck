import { accountKeys, createRecoveryCodes, recoveryCodesLeftQueryOptions } from '@potluck/api'
import { formatDate, t } from '@potluck/i18n'
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  Field,
  Skeleton,
  toast,
} from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Help } from '@/features/help/help'
import { copyText } from '@/features/invites/share'
import { useUserId } from '@/lib/auth'
import { useViewerTimezone } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { accountError } from './account-error'
import { disableTotp, startTotp, verifiedTotp, verifyTotp, type TotpEnrollment } from './actions'
import { CodeInput } from './code-input'
import { RecoveryCodes } from './recovery-codes'
import { SettingsRow } from './settings-section'

const totpKey = (userId: string) => [...accountKeys.all, 'totp', userId] as const

/** "JBSW Y3DP EHPK 3PXP": easier to type into an app by hand. */
const grouped = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ')

export function TwoFactorRow() {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const timeZone = useViewerTimezone()
  const factor = useQuery({ queryKey: totpKey(userId), queryFn: verifiedTotp })
  const on = !!factor.data
  const left = useQuery({ ...recoveryCodesLeftQueryOptions(supabase, userId), enabled: on })
  const [dialog, setDialog] = useState<'setup' | 'disable' | 'regenerate' | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [attempt, setAttempt] = useState(0)

  const refresh = () => queryClient.invalidateQueries({ queryKey: accountKeys.all })

  return (
    <SettingsRow
      icon={<ShieldCheck />}
      label={t('security.twoFactor.title')}
      value={
        factor.isPending ? (
          <Skeleton className="mt-1 h-4 w-32" />
        ) : on ? (
          <>
            {t('security.twoFactor.since', {
              date: formatDate(factor.data!.updated_at, { timeZone }),
            })}
            {left.data !== undefined && (
              <>
                <br />
                {t('security.twoFactor.recovery.left', { count: left.data })}
              </>
            )}
          </>
        ) : (
          t('security.twoFactor.hint')
        )
      }
      status={
        on && (
          <Badge tone="olive" dot>
            {t('security.twoFactor.on')}
          </Badge>
        )
      }
      action={
        factor.isPending ? null : on ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setDialog('disable')}>
              {t('security.twoFactor.disable')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog('regenerate')}>
              {t('security.twoFactor.recovery.regenerate')}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ink"
            onClick={() => {
              setAttempt((n) => n + 1)
              setDialog('setup')
            }}
          >
            {t('security.twoFactor.enable')}
          </Button>
        )
      }
    >
      <Help topic="twoFactor" showLabel className="justify-self-start" />

      <SetupDialog
        key={attempt}
        open={dialog === 'setup'}
        onOpenChange={(open) => setDialog(open ? 'setup' : null)}
        onEnabled={() => {
          toast.success(t('security.twoFactor.enabled'))
          void refresh()
        }}
      />
      {factor.data && (
        <DisableDialog
          open={dialog === 'disable'}
          onOpenChange={(open) => setDialog(open ? 'disable' : null)}
          factorId={factor.data.id}
          onDisabled={() => {
            toast.success(t('security.twoFactor.disabled'))
            void refresh()
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === 'regenerate'}
        onOpenChange={(open) => setDialog(open ? 'regenerate' : null)}
        title={t('security.twoFactor.recovery.regenerate')}
        description={t('security.twoFactor.recovery.regenerateBody')}
        confirmLabel={t('security.twoFactor.recovery.regenerate')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        onConfirm={async () => {
          try {
            setCodes(await createRecoveryCodes(supabase))
            void refresh()
          } catch (error) {
            toast.error(accountError(error))
            throw error
          }
        }}
      />
      <Dialog open={codes !== null} onOpenChange={(open) => !open && setCodes(null)}>
        <DialogContent
          title={t('security.twoFactor.recovery.title')}
          closeLabel={t('common.close')}
          variant="auto"
        >
          {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
        </DialogContent>
      </Dialog>
    </SettingsRow>
  )
}

/** Scan, confirm with a first code, then keep the recovery codes. */
function SetupDialog({
  open,
  onOpenChange,
  onEnabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onEnabled: () => void
}) {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // The row remounts this dialog (a new `key`) for every setup, so state starts fresh.
  useEffect(() => {
    if (!open) return
    let live = true
    startTotp()
      .then((next) => live && setEnrollment(next))
      .catch((failure: unknown) => {
        if (!live) return
        setFailed(true)
        toast.error(accountError(failure))
      })
    return () => {
      live = false
    }
  }, [open])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!enrollment || code.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      await verifyTotp(enrollment.factorId, code)
      try {
        setCodes(await createRecoveryCodes(supabase))
      } finally {
        onEnabled()
      }
    } catch (failure) {
      setError(accountError(failure))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        title={codes ? t('security.twoFactor.recovery.title') : t('security.twoFactor.setup.title')}
        closeLabel={t('common.close')}
        variant="auto"
      >
        {codes ? (
          <RecoveryCodes codes={codes} onDone={() => onOpenChange(false)} />
        ) : (
          <form className="grid gap-4 pt-2" onSubmit={onSubmit} noValidate>
            <p className="text-sm text-mute">{t('security.twoFactor.setup.scan')}</p>
            <div className="grid justify-items-center gap-3">
              {enrollment ? (
                // QR codes need a light ground to scan, whatever the theme.
                <img
                  src={enrollment.qrCode}
                  alt={t('security.twoFactor.setup.qr')}
                  className="size-48 rounded-card border border-line bg-white p-3"
                />
              ) : (
                <Skeleton className="size-48 rounded-card" />
              )}
            </div>
            {enrollment && (
              <div className="grid gap-1.5 rounded-input bg-sunken px-4 py-3">
                <p className="text-xs text-mute">{t('security.twoFactor.setup.manual')}</p>
                <div className="flex items-center justify-between gap-3">
                  <code className="min-w-0 font-bold tracking-wider break-all tabular-nums">
                    {grouped(enrollment.secret)}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Copy />}
                    onClick={async () => {
                      if (await copyText(enrollment.secret)) toast.success(t('common.copied'))
                    }}
                  >
                    {t('security.twoFactor.setup.copyKey')}
                  </Button>
                </div>
              </div>
            )}
            <Field
              label={t('security.twoFactor.code')}
              hint={t('security.twoFactor.setup.enter')}
              error={error}
            >
              <CodeInput
                value={code}
                onValueChange={setCode}
                disabled={!enrollment}
                aria-invalid={!!error}
              />
            </Field>
            <Button
              type="submit"
              block
              loading={busy}
              disabled={!enrollment || code.length !== 6 || failed}
            >
              {t('security.twoFactor.setup.submit')}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DisableDialog({
  open,
  onOpenChange,
  factorId,
  onDisabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  factorId: string
  onDisabled: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (code.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      await disableTotp(factorId, code)
      onOpenChange(false)
      setCode('')
      onDisabled()
    } catch (failure) {
      setError(accountError(failure))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        if (!next) {
          setCode('')
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent
        title={t('security.twoFactor.disableTitle')}
        description={t('security.twoFactor.disableBody')}
        closeLabel={t('common.close')}
        variant="auto"
      >
        <form className="grid gap-4 pt-2" onSubmit={onSubmit} noValidate>
          <Field label={t('security.twoFactor.code')} error={error}>
            <CodeInput autoFocus value={code} onValueChange={setCode} aria-invalid={!!error} />
          </Field>
          <Button type="submit" variant="primary" block loading={busy} disabled={code.length !== 6}>
            {t('security.twoFactor.disable')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
