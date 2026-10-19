import { Link } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { avatarPalette } from '@potluck/tokens'
import type { ReactNode } from 'react'
import { Wordmark } from '@/features/shell/brand'

interface AuthLayoutProps {
  title: ReactNode
  subtitle?: ReactNode
  /** A line above the form, e.g. which group you are about to join. */
  notice?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

const PLATES = [
  { emoji: '🥟', x: '12%', y: '16%', r: -8, size: 'size-24' },
  { emoji: '🍜', x: '50%', y: '9%', r: 6, size: 'size-28' },
  { emoji: '🥗', x: '78%', y: '24%', r: 10, size: 'size-24' },
  { emoji: '🌮', x: '26%', y: '36%', r: 4, size: 'size-32' },
  { emoji: '🍷', x: '62%', y: '44%', r: -10, size: 'size-20' },
] as const

/** The table seen from above: plates on a dark cloth, one per friend. */
function TableArt() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklab,var(--pl-tomato)_30%,transparent),transparent_55%),radial-gradient(circle_at_80%_90%,color-mix(in_oklab,var(--pl-saffron)_22%,transparent),transparent_50%)]" />
      {PLATES.map((p, i) => (
        <span
          key={p.emoji}
          className={`absolute grid place-items-center rounded-full border-[6px] text-5xl shadow-[0_18px_40px_-18px_rgb(0_0_0/0.6)] ${p.size}`}
          style={{
            left: p.x,
            top: p.y,
            rotate: `${p.r}deg`,
            backgroundColor: 'var(--pl-paper)',
            borderColor: avatarPalette[i % avatarPalette.length]!.bg,
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  )
}

/** Shared frame for sign in, sign up and password pages. Two panes from `lg`. */
export function AuthLayout({ title, subtitle, notice, footer, children }: AuthLayoutProps) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden on-hero lg:block">
        <TableArt />
        <div className="absolute inset-x-12 bottom-12">
          <p className="max-w-md font-display text-5xl leading-[1.02] italic">
            {t('auth.side.quote')}
          </p>
          <p className="mt-4 max-w-sm text-hero-mute">{t('auth.side.caption')}</p>
        </div>
        <Link
          to="/"
          className="absolute top-8 left-12 rounded-pill [--pl-ink:var(--pl-on-hero)]"
          aria-label={t('app.name')}
        >
          <Wordmark />
        </Link>
      </aside>
      <main id="main" className="flex min-h-dvh flex-col px-5 pt-6 pb-10 sm:px-8">
        <Link to="/" className="self-start rounded-pill lg:hidden" aria-label={t('app.name')}>
          <Wordmark />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-7 py-10">
          <header>
            <h1 className="font-display text-[2.75rem] leading-[1] tracking-tight">{title}</h1>
            {subtitle && <p className="mt-3 text-mute">{subtitle}</p>}
          </header>
          {notice && (
            <div className="rounded-card border border-saffron/50 bg-saffron-soft px-4 py-3 text-sm font-medium text-saffron-ink">
              {notice}
            </div>
          )}
          {children}
          {footer && <div className="text-sm text-mute">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
