import { t } from '@potluck/i18n'
import { Button, ConfirmDialog, toast } from '@potluck/ui'
import { useNavigate } from '@tanstack/react-router'
import { MonitorSmartphone } from 'lucide-react'
import { useState } from 'react'
import { signOut } from '@/lib/auth'
import { accountError } from './account-error'
import { EmailRow } from './email-row'
import { PasswordRow } from './password-row'
import { SettingsRow, SettingsSection } from './settings-section'
import { TwoFactorRow } from './two-factor-row'

function DevicesRow() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <SettingsRow
      icon={<MonitorSmartphone />}
      label={t('security.sessions.label')}
      value={t('security.sessions.hint')}
      action={
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t('security.sessions.signOutAll')}
        </Button>
      }
    >
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('security.sessions.confirmTitle')}
        description={t('security.sessions.confirmBody')}
        confirmLabel={t('security.sessions.signOutAll')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        tone="danger"
        onConfirm={async () => {
          try {
            await signOut('global')
          } catch (error) {
            toast.error(accountError(error))
            throw error
          }
          toast(t('security.sessions.done'))
          await navigate({ to: '/sign-in', replace: true })
        }}
      />
    </SettingsRow>
  )
}

/** Me page: email, password, two-step sign in and every signed in device. */
export function SecuritySection() {
  return (
    <SettingsSection id="me-security" title={t('security.title')}>
      <EmailRow />
      <PasswordRow />
      <TwoFactorRow />
      <DevicesRow />
    </SettingsSection>
  )
}
