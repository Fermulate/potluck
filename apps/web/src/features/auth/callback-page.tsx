import { Link, useNavigate } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { Button, LoadingDots, toast } from '@potluck/ui'
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
  const [halfway, setHalfway] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const url = new URL(window.location.href)
    const hash = new URLSearchParams(url.hash.slice(1))
    const recovery = hash.get('type') === 'recovery' || url.searchParams.get('type') === 'recovery'
    const emailChange = hash.get('type') === 'email_change'

    async function finish() {
      if (url.searchParams.get('error') || hash.get('error')) throw new Error('link_failed')
      // An email change needs a link from the old and the new address. The first one only says
      // so (a `message`, no tokens); the second one carries the updated session.
      if (hash.get('message') && !hash.get('access_token')) {
        setHalfway(true)
        return
      }
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
      if (emailChange && data.session.user.email) {
        toast.success(t('security.email.changed', { email: data.session.user.email }))
      }
    }

    finish().catch(() => setFailed(true))
  }, [navigate, redirect])

  if (halfway) {
    return (
      <AuthLayout title={t('security.email.halfConfirmed')}>
        <Button asChild variant="secondary" className="justify-self-start">
          <Link to="/me">{t('nav.me')}</Link>
        </Button>
      </AuthLayout>
    )
  }

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
