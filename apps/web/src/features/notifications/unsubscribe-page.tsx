import {
  emailUnsubscribe,
  unsubscribePreviewQueryOptions,
  type UnsubscribeResult,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, LoadingDots, usePrefersReducedMotion } from '@potluck/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
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

const what = (category: UnsubscribeResult['category']) =>
  category && category !== 'all'
    ? t(`settings.notificationPrefs.categories.${category}.about`)
    : null

function Mailbox({ open, reduced }: { open: boolean; reduced: boolean }) {
  return (
    <motion.span
      key={open ? 'open' : 'closed'}
      aria-hidden
      className="text-7xl"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12, rotate: -10 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 22 }}
    >
      {open ? '📬' : '📭'}
    </motion.span>
  )
}

/**
 * Where an email's unsubscribe link lands. Opening it changes nothing (link scanners open links
 * too); one tap on Unsubscribe does it, signed in or not, and the page offers to undo it. Mail
 * clients with a built-in unsubscribe button POST to the `unsubscribe` edge function instead.
 */
export function UnsubscribePage({ token }: { token: string | undefined }) {
  const session = useSession()
  const reduced = usePrefersReducedMotion()
  const preview = useQuery({
    ...unsubscribePreviewQueryOptions(supabase, token ?? ''),
    enabled: !!token,
  })
  const off = useMutation({
    mutationFn: (tok: string) => emailUnsubscribe(supabase, tok, 'unsubscribe'),
  })
  const on = useMutation({ mutationFn: (tok: string) => emailUnsubscribe(supabase, tok, 'undo') })

  const manage = (
    <Button asChild variant="ghost">
      <Link to={session ? '/me' : '/sign-in'}>{t('unsubscribe.manage')}</Link>
    </Button>
  )

  if (!token || errorCode(preview.error) === 'invalid_unsubscribe_link') {
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

  if (preview.isError) {
    return (
      <Frame>
        <span aria-hidden className="text-7xl">
          📡
        </span>
        <h1 className="flourish text-4xl leading-tight">{t('unsubscribe.title')}</h1>
        <p className="max-w-xs text-mute">{t('unsubscribe.failed')}</p>
        <Button loading={preview.isFetching} onClick={() => void preview.refetch()}>
          {t('unsubscribe.retry')}
        </Button>
      </Frame>
    )
  }

  if (!preview.data) {
    return (
      <Frame>
        <LoadingDots size={28} className="text-mute" />
        <p role="status" className="text-mute">
          {t('unsubscribe.working')}
        </p>
      </Frame>
    )
  }

  const link = preview.data
  const topic = what(link.category)
  const account = link.email ? (
    <p className="text-sm font-semibold text-mute">
      {t('unsubscribe.account', { email: link.email })}
    </p>
  ) : null
  const failed = (off.isError || on.isError) && (
    <p role="alert" className="text-sm text-tomato-ink">
      {t('unsubscribe.failed')}
    </p>
  )

  // Back on: either undone here, or resubscribed from an already-off link.
  if (on.isSuccess) {
    return (
      <Frame>
        <Mailbox open reduced={reduced} />
        <h1 className="font-display text-5xl leading-[0.95]">{t('unsubscribe.undone')}</h1>
        {account}
        <p role="status" className="max-w-xs text-mute">
          {t('unsubscribe.undoneBody')}
        </p>
        {manage}
      </Frame>
    )
  }

  // Off: just now, or the link's emails were already off.
  if (off.isSuccess || !link.subscribed) {
    return (
      <Frame>
        <Mailbox open={false} reduced={reduced} />
        <h1 className="font-display text-5xl leading-[0.95]">
          {off.isSuccess ? t('unsubscribe.done') : t('unsubscribe.alreadyTitle')}
        </h1>
        {account}
        <p role="status" className="max-w-xs text-mute">
          {topic ? t('unsubscribe.doneOne', { what: topic }) : t('unsubscribe.doneAll')}
        </p>
        <div className="grid w-full gap-2">
          <Button variant="secondary" block loading={on.isPending} onClick={() => on.mutate(token)}>
            {off.isSuccess ? t('unsubscribe.undo') : t('unsubscribe.resubscribe')}
          </Button>
          {failed}
          {manage}
        </div>
      </Frame>
    )
  }

  return (
    <Frame>
      <Mailbox open reduced={reduced} />
      <h1 className="font-display text-5xl leading-[0.95]">{t('unsubscribe.askTitle')}</h1>
      {account}
      <p className="max-w-xs text-mute">
        {topic ? t('unsubscribe.askOne', { what: topic }) : t('unsubscribe.askAll')}
      </p>
      <div className="grid w-full gap-2">
        <Button block loading={off.isPending} onClick={() => off.mutate(token)}>
          {t('unsubscribe.confirm')}
        </Button>
        {failed}
        {manage}
      </div>
    </Frame>
  )
}
