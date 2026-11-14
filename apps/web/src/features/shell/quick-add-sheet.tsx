import { t } from '@potluck/i18n'
import { cn, Sheet, SheetContent, usePrefersReducedMotion } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { ArrowRightLeft, CalendarHeart, ChevronRight, Receipt } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

type QuickAddTarget = '/new/expense' | '/new/plan' | '/new/settle'

interface Choice {
  to: QuickAddTarget
  title: string
  hint: string
  icon: ReactNode
  tile: string
}

function choices(): Choice[] {
  return [
    {
      to: '/new/expense',
      title: t('nav.quickAdd.expense'),
      hint: t('nav.quickAdd.expenseHint'),
      icon: <Receipt />,
      tile: 'bg-tomato-strong text-on-tomato',
    },
    {
      to: '/new/plan',
      title: t('nav.quickAdd.plan'),
      hint: t('nav.quickAdd.planHint'),
      icon: <CalendarHeart />,
      tile: 'bg-saffron text-on-saffron',
    },
    {
      to: '/new/settle',
      title: t('nav.quickAdd.settle'),
      hint: t('nav.quickAdd.settleHint'),
      icon: <ArrowRightLeft />,
      tile: 'bg-olive text-on-olive',
    },
  ]
}

export function QuickAddSheet({
  open,
  onOpenChange,
  groupId,
  expenseNote,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Set when opened from inside a group, so the new thing lands there. */
  groupId?: string
  /** Why no expense can be added here (a 1:1 tab across a block); the choice is shown off. */
  expenseNote?: string | null
}) {
  const reduced = usePrefersReducedMotion()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={t('nav.quickAdd.title')} closeLabel={t('common.close')} size="sm">
        <ul className="grid gap-2 pt-2">
          {choices().map((choice, i) => {
            const off = choice.to === '/new/expense' && !!expenseNote
            const body = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'grid size-14 shrink-0 place-items-center rounded-[1rem] transition-transform duration-200 [&_svg]:size-6',
                    off ? 'bg-sunken text-mute' : cn('group-hover:rotate-[-6deg]', choice.tile),
                  )}
                >
                  {choice.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[1.0625rem] font-bold">{choice.title}</span>
                  <span className="block text-sm text-pretty text-mute">
                    {off ? expenseNote : choice.hint}
                  </span>
                </span>
              </>
            )
            return (
              <motion.li
                key={choice.to}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduced
                    ? { duration: 0.15 }
                    : { type: 'spring', stiffness: 380, damping: 30, delay: 0.04 + i * 0.03 }
                }
              >
                {off ? (
                  <div
                    role="link"
                    aria-disabled="true"
                    className="flex items-center gap-4 rounded-card p-3 opacity-70"
                  >
                    {body}
                  </div>
                ) : (
                  <Link
                    to={choice.to}
                    // The /new routes own their search schema; `groupId` is the shared contract.
                    search={(groupId ? { groupId } : {}) as never}
                    onClick={() => onOpenChange(false)}
                    className="group flex items-center gap-4 rounded-card p-3 transition-colors duration-150 hover:bg-sunken"
                  >
                    {body}
                    <ChevronRight aria-hidden className="size-5 text-mute" />
                  </Link>
                )}
              </motion.li>
            )
          })}
        </ul>
      </SheetContent>
    </Sheet>
  )
}
