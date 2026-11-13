import { t } from '@potluck/i18n'
import { ArrowUpRight, MessageSquareHeart } from 'lucide-react'
import { FEEDBACK_URL } from '@/lib/docs'

/** Which build this is (for bug reports) and the way to tell us what to cook next. */
export function AboutSection() {
  return (
    <section aria-labelledby="me-about" className="grid gap-3">
      <h2 id="me-about" className="text-sm font-bold text-mute">
        {t('security.about.title')}
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href={FEEDBACK_URL}
          target="_blank"
          rel="noopener"
          className="-m-2 flex items-center gap-3 rounded-card p-2 font-semibold transition-colors hover:bg-sunken"
        >
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-full bg-tomato-soft text-tomato-ink"
          >
            <MessageSquareHeart className="size-[1.125rem]" />
          </span>
          {t('security.about.feedback')} <span className="sr-only">({t('help.newTab')})</span>
          <ArrowUpRight aria-hidden className="size-4 text-mute" />
        </a>
        <p className="text-sm text-mute tabular-nums">
          {t('security.about.version', { version: __APP_VERSION__ })}
        </p>
      </div>
    </section>
  )
}
