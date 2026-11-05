import { t } from '@potluck/i18n'
import { Button } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { ArrowRightLeft, CalendarHeart, Receipt } from 'lucide-react'
import { lazy, Suspense, type ReactNode } from 'react'
import { Wordmark } from './brand'
import { heroFrame } from './hero-frame'

// The animated demo pulls in the motion library; the headline and buttons paint without it.
const HeroDemo = lazy(() => import('./hero-demo').then((m) => ({ default: m.HeroDemo })))

/** Tomato gingham: the tablecloth the demo cards sit on. */
const gingham =
  'bg-paper [background-image:linear-gradient(90deg,color-mix(in_oklab,var(--pl-tomato)_42%,transparent)_50%,transparent_50%),linear-gradient(color-mix(in_oklab,var(--pl-tomato)_42%,transparent)_50%,transparent_50%)] [background-size:44px_44px]'

function Feature({
  icon,
  tile,
  title,
  body,
}: {
  icon: ReactNode
  tile: string
  title: string
  body: string
}) {
  return (
    <div className="grid content-start gap-3">
      <span
        aria-hidden
        className={`grid size-12 place-items-center rounded-[0.875rem] [&_svg]:size-6 ${tile}`}
      >
        {icon}
      </span>
      <h2 className="font-display text-3xl leading-none">{title}</h2>
      <p className="max-w-[34ch] text-mute">{body}</p>
    </div>
  )
}

/** Public front door for signed-out visitors. Signed-in people are sent to /home by the route. */
export function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 pt-5 sm:px-8">
        <Link to="/" className="rounded-pill" aria-label={t('app.name')}>
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/sign-in">{t('app.landing.signIn')}</Link>
          </Button>
          <Button asChild variant="ink" size="sm">
            <Link to="/sign-up">{t('app.landing.getStarted')}</Link>
          </Button>
        </nav>
      </header>

      <main id="main">
        <section className="relative">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 pt-12 pb-0 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-center lg:gap-6 lg:pt-16">
            <div className="relative z-10 lg:pb-24">
              <h1 className="font-display text-[clamp(3.25rem,10.5vw,7.25rem)] leading-[0.88] tracking-[-0.025em]">
                {t('app.landing.title')
                  .split(/(?<=\.)\s+/)
                  .map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
              </h1>
              <p className="mt-6 max-w-[42ch] text-lg text-mute">{t('app.landing.body')}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link to="/sign-up">{t('app.landing.cta')}</Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <Link to="/sign-in">{t('app.landing.secondary')}</Link>
                </Button>
              </div>
            </div>
            <div className="relative z-10 -mb-28 lg:-mb-32">
              <Suspense fallback={<div aria-hidden className={heroFrame} />}>
                <HeroDemo />
              </Suspense>
            </div>
          </div>
          {/* The table edge */}
          <div aria-hidden className={`relative h-40 border-t-4 border-ink/80 sm:h-44 ${gingham}`}>
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-transparent" />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid gap-12 md:grid-cols-3 md:gap-10">
            <Feature
              icon={<Receipt />}
              tile="bg-tomato-strong text-on-tomato"
              title={t('app.landing.features.tab.title')}
              body={t('app.landing.features.tab.body')}
            />
            <Feature
              icon={<CalendarHeart />}
              tile="bg-saffron text-on-saffron"
              title={t('app.landing.features.night.title')}
              body={t('app.landing.features.night.body')}
            />
            <Feature
              icon={<ArrowRightLeft />}
              tile="bg-olive text-on-olive"
              title={t('app.landing.features.square.title')}
              body={t('app.landing.features.square.body')}
            />
          </div>
        </section>

        <section className="on-hero">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:px-8 md:flex-row md:items-end md:justify-between lg:py-24">
            <div>
              <h2 className="font-display text-6xl leading-[0.9] italic sm:text-7xl">
                {t('app.landing.closing.title')}
              </h2>
              <p className="mt-4 max-w-[44ch] text-hero-mute">{t('app.landing.closing.body')}</p>
            </div>
            <Button asChild size="lg">
              <Link to="/sign-up">{t('app.landing.cta')}</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm text-mute sm:px-8">
        <Wordmark className="text-xl" />
        <p>
          {t('app.landing.footer.license')}{' '}
          <a
            href="https://github.com/Fermulate/potluck"
            className="font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4"
          >
            {t('app.landing.footer.source')}
          </a>
        </p>
      </footer>
    </div>
  )
}
