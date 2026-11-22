import { t } from '@potluck/i18n'
import { Button, cn } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useSession } from '@/lib/auth'
import { Wordmark } from './brand'

/**
 * The page around screens people reach from a shared link, signed in or out (guest links, quick
 * polls): the wordmark home and a saffron glow, no app chrome. `wide` is for a grid beside a
 * header; the narrow column is for a dead end or a short form.
 */
export function PublicFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[50dvh] bg-[radial-gradient(ellipse_at_30%_0%,color-mix(in_oklab,var(--pl-saffron)_32%,transparent),transparent_65%)]"
      />
      <main
        id="main"
        className={
          wide
            ? 'relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-5'
            : 'relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-5 pb-10'
        }
      >
        <Link
          to="/"
          className={wide ? 'self-start rounded-pill' : 'self-center rounded-pill'}
          aria-label={t('app.name')}
        >
          <Wordmark />
        </Link>
        {children}
      </main>
    </div>
  )
}

/** Where someone with no account goes next: sign up, or a look at what Potluck is. */
export function NextSteps() {
  const session = useSession()
  if (session) {
    return (
      <Button asChild variant="secondary">
        <Link to="/home">{t('guests.closed.home')}</Link>
      </Button>
    )
  }
  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <Button asChild size="lg" block>
        <Link to="/sign-up">{t('guests.closed.signUp')}</Link>
      </Button>
      <Button asChild variant="ghost" block>
        <Link to="/">{t('guests.closed.action')}</Link>
      </Button>
    </div>
  )
}

/**
 * A dead end with a way out: the link closed, is unknown or is full. `notice` says what the
 * visitor lost (times they painted but did not save); `actions` replaces the default next steps.
 */
export function DeadEnd({
  emoji,
  title,
  body,
  notice,
  actions = <NextSteps />,
}: {
  emoji: string
  title: string
  body: string
  notice?: string
  actions?: ReactNode
}) {
  return (
    <PublicFrame>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <span aria-hidden className="text-7xl">
          {emoji}
        </span>
        <h1 className="flourish text-4xl leading-tight">{title}</h1>
        {notice && <Notice>{notice}</Notice>}
        <p className="max-w-xs text-pretty text-mute">{body}</p>
        {actions}
      </div>
    </PublicFrame>
  )
}

/** Something the visitor lost or cannot do, said once and plainly. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-[0.875rem] bg-tomato-soft px-3.5 py-2.5 text-sm font-semibold text-tomato-ink"
    >
      {children}
    </p>
  )
}

/** The quiet sign up pitch at the foot of a public page. */
export function Pitch({
  title,
  body,
  help,
  className,
}: {
  title: string
  body: string
  /** A "?" beside the action. */
  help?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex-col gap-2 rounded-card border border-dashed border-line-strong p-4',
        className,
      )}
    >
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-mute">{body}</p>
      <div className="flex items-center justify-between gap-2">
        <Button asChild size="sm" variant="ghost" className="-ml-2 self-start">
          <Link to="/sign-up">{t('guests.page.pitchAction')}</Link>
        </Button>
        {help}
      </div>
    </div>
  )
}
