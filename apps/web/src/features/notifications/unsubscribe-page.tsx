import { emailUnsubscribe, type NotificationCategory } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, LoadingDots, usePrefersReducedMotion } from '@potluck/ui'
import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Wordmark } from '@/features/shell/brand'
import { useSession } from '@/lib/auth'
import { errorCode } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60dvh] bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--pl-olive)_22%,transparent),transparent_65%)]"
      />
      <main
        id="main"
        className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-6 pb-10"
      >
        <Link to="/" className="self-center rounded-pill" aria-label={t('app.name')}>
          <Wordmark />
        </Link>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
          {children}
        </div>
      </main>
    </div>
  )
}

const about = (category: NotificationCategory | 'all' | null) =>
  category && category !== 'all'
    ? t('unsubscribe.doneOne', {
        what: t(`settings.notificationPrefs.categories.${category}.about`),
      })
    : t('unsubscribe.doneAll')

/**
 * Where an email's unsubscribe link lands. Opening it is the one click: the signed token turns
 * that email type off right away, signed in or not, and the page offers to undo it. Mail clients
 * that support one-click unsubscribe POST to the `unsubscribe` edge function instead.
 */
export function UnsubscribePage({ token }: { token: string | undefined }) {
  const session = useSession()
  const reduced = usePrefersReducedMotion()
  // The token already applied, so a re-render (or React's dev double effect) never sends it twice.
  const applied = useRef<string | null>(null)
  const off = useMutation({ mutationFn: (tok: string) => emailUnsubscribe(supabase, tok) })
  const on = useMutation({ mutationFn: (tok: string) => emailUnsubscribe(supabase, tok, true) })
  const { mutate: unsubscribe } = off

  useEffect(() => {
    if (!token || applied.current === token) return
    applied.current = token
    unsubscribe(token)
  }, [token, unsubscribe])

  const manage = (
    <Button asChild variant="ghost">
      <Link to={session ? '/me' : '/sign-in'}>{t('unsubscribe.manage')}</Link>
    </Button>
  )

  if (!token || errorCode(off.error) === 'invalid_unsubscribe_link') {
    return (
      <Frame>
        <span aria-hidden className="text-7xl">
          🧊
        </span>
        <h1 className="flourish text-4xl leading-tight">{t('unsubscribe.invalidTitle')}</h1>
        <p className="max-w-xs text-mute">{t('unsubscribe.invalidBody')}</p>
        {manage}
      </Frame>
    )
  }

  if (off.isError) {
    return (
      <Frame>
        <span aria-hidden className="text-7xl">
          📡
        </span>
        <h1 className="flourish text-4xl leading-tight">{t('unsubscribe.title')}</h1>
        <p className="max-w-xs text-mute">{t('unsubscribe.failed')}</p>
        <Button loading={off.isPending} onClick={() => off.mutate(token)}>
          {t('unsubscribe.retry')}
        </Button>
      </Frame>
    )
  }

  if (!off.isSuccess) {
    return (
      <Frame>
        <LoadingDots size={28} className="text-mute" />
        <p role="status" className="text-mute">
          {t('unsubscribe.working')}
        </p>
      </Frame>
    )
  }

  const resubscribed = on.isSuccess
  return (
    <Frame>
      <motion.span
        key={resubscribed ? 'on' : 'off'}
        aria-hidden
        className="text-7xl"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12, rotate: -10 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 22 }}
      >
        {resubscribed ? '📬' : '📭'}
      </motion.span>
      <h1 className="font-display text-5xl leading-[0.95]">
        {resubscribed ? t('unsubscribe.undone') : t('unsubscribe.done')}
      </h1>
      <p role="status" className="max-w-xs text-mute">
        {resubscribed ? t('unsubscribe.undoneBody') : about(off.data)}
      </p>
      <div className="grid w-full gap-2">
        {!resubscribed && (
          <Button variant="secondary" block loading={on.isPending} onClick={() => on.mutate(token)}>
            {t('unsubscribe.undo')}
          </Button>
        )}
        {on.isError && <p className="text-sm text-tomato-ink">{t('unsubscribe.failed')}</p>}
        {manage}
      </div>
    </Frame>
  )
}
