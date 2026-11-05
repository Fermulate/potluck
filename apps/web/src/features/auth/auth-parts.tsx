import { appConfigQueryOptions, isFlagOn } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, IconButton, Input, toast, type InputProps } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useState } from 'react'
import { authCallbackUrl } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'trailing'>>(
  function PasswordInput(props, ref) {
    const [visible, setVisible] = useState(false)
    return (
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        trailing={
          <IconButton
            size="sm"
            variant="ghost"
            label={visible ? t('auth.fields.hidePassword') : t('auth.fields.showPassword')}
            icon={visible ? <EyeOff /> : <Eye />}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          />
        }
        {...props}
      />
    )
  },
)

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.8-5.4 3.8-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12Z"
      />
    </svg>
  )
}

function AppleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.1-1.2 2.9-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.4-1-2.4-4ZM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4Z" />
    </svg>
  )
}

/** Google and Apple sign in, each shown only when its `app_config` flag is on. */
export function OAuthButtons({ redirect }: { redirect?: string }) {
  const { data: config } = useQuery(appConfigQueryOptions(supabase))
  const google = isFlagOn(config, 'google_auth')
  const apple = isFlagOn(config, 'apple_auth')
  if (!google && !apple) return null

  const start = async (provider: 'google' | 'apple') => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: authCallbackUrl(redirect) },
    })
    if (error) toast.error(errorMessage(error))
  }

  return (
    <div className="grid gap-3">
      {google && (
        <Button variant="secondary" block leadingIcon={<GoogleGlyph />} onClick={() => start('google')}>
          {t('auth.continueWithGoogle')}
        </Button>
      )}
      {apple && (
        <Button variant="ink" block leadingIcon={<AppleGlyph />} onClick={() => start('apple')}>
          {t('auth.continueWithApple')}
        </Button>
      )}
      <div className="flex items-center gap-3 text-xs font-semibold text-mute" role="separator">
        <span className="h-px flex-1 bg-line" />
        {t('auth.or')}
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  )
}

/** Shown after a link email goes out. */
export function CheckEmail({
  email,
  onResend,
  onBack,
}: {
  email: string
  onResend: () => Promise<void>
  onBack: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="grid gap-5">
      <div className="grid size-16 rotate-[-6deg] place-items-center rounded-[1.25rem] bg-saffron text-4xl shadow-raised">
        <span aria-hidden>💌</span>
      </div>
      <p className="text-lg" aria-live="polite">
        {t('auth.checkEmail.body', { email })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onResend()
              toast.success(t('auth.checkEmail.resent'))
            } finally {
              setBusy(false)
            }
          }}
        >
          {t('auth.checkEmail.resend')}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {t('auth.checkEmail.back')}
        </Button>
      </div>
    </div>
  )
}
