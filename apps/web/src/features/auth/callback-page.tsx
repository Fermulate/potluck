import { Link, useNavigate } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { Button, LoadingDots } from '@potluck/ui'
import { useEffect, useRef, useState } from 'react'
import { needsOnboarding, safeRedirect } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from './auth-layout'

/**
 * Finishes email links and OAuth: exchanges a PKCE `code` if there is one, otherwise lets the
 * client pick the tokens out of the URL hash, then sends the person on.
 */
export function AuthCallbackPage({ redirect }: { redirect?: string }) {
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const url = new URL(window.location.href)
    const hash = new URLSearchParams(url.hash.slice(1))
    const recovery = hash.get('type') === 'recovery' || url.searchParams.get('type') === 'recovery'

    async function finish() {
      if (url.searchParams.get('error') || hash.get('error')) throw new Error('link_failed')
      // The client may already have read the URL during start up.
      let { data } = await supabase.auth.getSession()
      const code = url.searchParams.get('code')
      if (!data.session && code) {
        const exchanged = await supabase.auth.exchangeCodeForSession(code)
        if (exchanged.error) throw exchanged.error
        data = { session: exchanged.data.session }
      }
      if (!data.session) throw new Error('no_session')
      const target = recovery ? '/reset-password' : safeRedirect(redirect)
      if (!recovery && needsOnboarding(data.session)) {
        await navigate({ to: '/welcome', search: { redirect: target }, replace: true })
      } else {
        await navigate({ href: target, replace: true })
      }
    }

    finish().catch(() => setFailed(true))
  }, [navigate, redirect])

  if (failed) {
    return (
      <AuthLayout title={t('auth.callback.failed')}>
        <Button asChild variant="secondary" className="justify-self-start">
          <Link to="/sign-in">{t('auth.callback.tryAgain')}</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.callback.working')}>
      <div role="status" aria-label={t('common.loading')} className="text-tomato">
        <LoadingDots size={28} />
      </div>
    </AuthLayout>
  )
}
