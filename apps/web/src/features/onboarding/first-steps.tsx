import { t } from '@potluck/i18n'
import { Button, cn } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { Check, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { HELP_PAGES } from '@/features/help/topics'
import { docsUrl } from '@/lib/docs'

function Step({
  number,
  state,
  title,
  hint,
  action,
}: {
  number: number
  state: 'done' | 'current' | 'later'
  title: string
  hint: string
  action?: ReactNode
}) {
  return (
    <li
      aria-current={state === 'current' ? 'step' : undefined}
      className={cn('flex items-start gap-3 py-3', state === 'later' && 'opacity-60')}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full tabular text-sm font-bold',
          state === 'done' && 'bg-olive text-on-olive',
          state === 'current' && 'bg-tomato-strong text-on-tomato',
          state === 'later' && 'border border-line-strong text-mute',
        )}
      >
        {state === 'done' ? <Check className="size-4" strokeWidth={3} /> : number}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('font-semibold', state === 'done' && 'text-mute line-through')}>
          {title}
          {state === 'done' && <span className="sr-only"> ({t('common.done')})</span>}
        </p>
        {state !== 'done' && <p className="text-sm text-mute">{hint}</p>}
        {state === 'current' && action && <div className="mt-3">{action}</div>}
      </div>
    </li>
  )
}

/**
 * The first run checklist on Home: start a group, add people, add an expense. It shows the one
 * thing to do next. Home decides who sees it: only someone new, until a group has someone else
 * in it (from there the group's own screens lead on) or the card is hidden. `groupId` is the
 * group they started, once there is one.
 */
export function FirstSteps({ groupId, onHide }: { groupId?: string; onHide: () => void }) {
  const done = groupId ? 1 : 0

  return (
    <section
      aria-labelledby="first-steps-title"
      className="relative overflow-hidden rounded-card border border-line bg-card"
    >
      <div aria-hidden className="h-3 border-b border-line gingham" />
      <div className="px-4 pt-4 pb-2 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="first-steps-title" className="flourish text-3xl leading-none">
              {t('home.firstSteps.title')}
            </h2>
            <p className="mt-2 text-sm text-mute">{t('home.firstSteps.body')}</p>
          </div>
          <button
            type="button"
            onClick={onHide}
            aria-label={t('home.firstSteps.hide')}
            title={t('home.firstSteps.hide')}
            className="-mt-1.5 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-mute transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <p className="mt-3 tabular text-xs font-semibold text-mute">
          {t('home.firstSteps.progress', { done, total: 3 })}
        </p>
        <ol className="mt-1 divide-y divide-line">
          <Step
            number={1}
            state={groupId ? 'done' : 'current'}
            title={t('home.firstSteps.group')}
            hint={t('home.firstSteps.groupHint')}
            action={
              <Button asChild size="sm">
                <Link to="/groups" search={{ new: true }}>
                  {t('home.firstSteps.groupAction')}
                </Link>
              </Button>
            }
          />
          <Step
            number={2}
            state={groupId ? 'current' : 'later'}
            title={t('home.firstSteps.people')}
            hint={t('home.firstSteps.peopleHint')}
            action={
              groupId && (
                <Button asChild size="sm">
                  <Link to="/groups/$groupId/members" params={{ groupId }}>
                    {t('home.firstSteps.peopleAction')}
                  </Link>
                </Button>
              )
            }
          />
          <Step
            number={3}
            state="later"
            title={t('home.firstSteps.expense')}
            hint={t('home.firstSteps.expenseHint')}
          />
        </ol>
      </div>
      <a
        href={docsUrl(HELP_PAGES.gettingStarted)}
        target="_blank"
        rel="noopener"
        className="flex min-h-11 items-center border-t border-line px-4 text-sm font-semibold text-mute hover:text-ink sm:px-5"
      >
        <span className="underline decoration-tomato decoration-2 underline-offset-4">
          {t('help.section.gettingStarted')}
        </span>
        <span className="sr-only"> ({t('help.newTab')})</span>
      </a>
    </section>
  )
}
