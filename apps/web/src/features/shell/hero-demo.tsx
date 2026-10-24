import { DEFAULT_LOCALE, t } from '@potluck/i18n'
import { avatarColor } from '@potluck/tokens'
import {
  Amount,
  cn,
  HeatCell,
  Stamp,
  StampAnimation,
  usePrefersReducedMotion,
  type HeatLevel,
} from '@potluck/ui'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

const CURRENCY = 'USD'

const ITEMS = [
  { key: 'dumplings', cents: 3840 },
  { key: 'buns', cents: 2970 },
  { key: 'noodles', cents: 5250 },
  { key: 'tea', cents: 2820 },
] as const
const TOTAL = ITEMS.reduce((sum, item) => sum + item.cents, 0)

const PEOPLE = [
  { id: 'demo-ava', name: 'Ava' },
  { id: 'demo-ben', name: 'Ben' },
  { id: 'demo-cleo', name: 'Cleo' },
  { id: 'demo-dev', name: 'Dev' },
] as const
const SHARE = TOTAL / PEOPLE.length

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const
const HOURS = ['5', '6', '7', '8'] as const
/** Final heat per [hour][day]. Thursday at 7 is the night everyone can make. */
const HEAT: HeatLevel[][] = [
  [1, 0, 2, 2, 1],
  [2, 1, 3, 3, 2],
  [1, 2, 2, 4, 3],
  [0, 1, 1, 3, 2],
]
/** The order friends paint cells in, so the grid warms up unevenly like real people. */
const PAINT_ORDER = [12, 7, 17, 2, 8, 13, 18, 3, 11, 6, 16, 9, 14, 1, 19, 4, 10, 15, 5, 0]
const BEST = { row: 2, col: 3 }

// Phase timeline in ms. The loop restarts after `end`.
const T = { items: 250, total: 1500, split: 2300, paint: 4300, stamp: 7200, end: 10800 }
type Phase = 'items' | 'total' | 'split' | 'paint' | 'stamp'

function usePhase(reduced: boolean): { phase: Phase; painted: number; cycle: number } {
  const [cycle, setCycle] = useState(0)
  const [phase, setPhase] = useState<Phase>(reduced ? 'stamp' : 'items')
  const [painted, setPainted] = useState(reduced ? PAINT_ORDER.length : 0)

  useEffect(() => {
    if (reduced) return
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    at(0, () => {
      setPhase('items')
      setPainted(0)
    })
    at(T.total, () => setPhase('total'))
    at(T.split, () => setPhase('split'))
    at(T.paint, () => setPhase('paint'))
    const step = (T.stamp - T.paint - 300) / PAINT_ORDER.length
    PAINT_ORDER.forEach((_, i) => at(T.paint + 200 + i * step, () => setPainted(i + 1)))
    at(T.stamp, () => setPhase('stamp'))
    at(T.end, () => setCycle((c) => c + 1))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [cycle, reduced])

  return { phase, painted, cycle }
}

const order: Phase[] = ['items', 'total', 'split', 'paint', 'stamp']
const reached = (phase: Phase, target: Phase) => order.indexOf(phase) >= order.indexOf(target)

function Face({ id, name, size = 'md' }: { id: string; name: string; size?: 'sm' | 'md' }) {
  const color = avatarColor(id)
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-bold ring-2 ring-card',
        size === 'md' ? 'size-10 text-sm' : 'size-7 text-[0.6875rem]',
      )}
      style={{ backgroundColor: color.bg, color: color.fg }}
    >
      {name[0]}
    </span>
  )
}

function Receipt({ phase, cycle }: { phase: Phase; cycle: number }) {
  const reduced = usePrefersReducedMotion()
  return (
    <div className="relative w-[18.5rem] rotate-[-4deg] sm:w-[20rem]">
      <div className="rounded-t-[1.125rem] bg-card px-5 pt-5 pb-4 shadow-sheet">
        <div className="flex items-center justify-between">
          <p className="font-display text-2xl leading-none">{t('app.landing.demo.receipt')}</p>
          <span aria-hidden className="text-2xl">
            🥟
          </span>
        </div>
        <p className="mt-1 text-xs text-mute">{t('app.landing.demo.paidBy', { name: 'Ava' })}</p>
        <ul className="mt-4 grid gap-2 border-t border-dashed border-line-strong pt-3 text-sm">
          {ITEMS.map((item, i) => (
            <motion.li
              key={`${cycle}-${item.key}`}
              className="flex justify-between gap-3"
              initial={reduced ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                delay: reduced ? 0 : i * 0.22,
                type: 'spring',
                stiffness: 380,
                damping: 30,
              }}
            >
              <span>{t(`app.landing.demo.items.${item.key}`)}</span>
              <Amount
                cents={item.cents}
                currency={CURRENCY}
                locale={DEFAULT_LOCALE}
                tone="inherit"
              />
            </motion.li>
          ))}
        </ul>
        <div
          className={cn(
            'mt-3 flex items-baseline justify-between border-t border-ink pt-3 transition-opacity duration-500',
            reached(phase, 'total') ? 'opacity-100' : 'opacity-0',
          )}
        >
          <span className="text-sm font-bold">{t('app.landing.demo.total')}</span>
          <Amount
            cents={TOTAL}
            currency={CURRENCY}
            locale={DEFAULT_LOCALE}
            tone="inherit"
            className="text-2xl font-extrabold"
          />
        </div>
      </div>
      <div className="rounded-b-[1.125rem] bg-sunken px-5 pt-3 pb-5 shadow-sheet">
        <p className="text-xs font-bold text-mute">{t('app.landing.demo.split')}</p>
        <ul className="mt-2 grid grid-cols-4 gap-2">
          {PEOPLE.map((person, i) => (
            <li key={person.id} className="flex flex-col items-center gap-1">
              <motion.span
                animate={
                  reached(phase, 'split') && !reduced
                    ? { y: [0, -6, 0], transition: { delay: i * 0.08, duration: 0.45 } }
                    : { y: 0 }
                }
              >
                <Face id={person.id} name={person.name} />
              </motion.span>
              <span className="text-[0.6875rem] font-semibold">{person.name}</span>
              <span className="h-4 text-[0.75rem] font-bold">
                {reached(phase, 'split') && (
                  <Amount
                    key={`${cycle}-share`}
                    cents={SHARE}
                    currency={CURRENCY}
                    locale={DEFAULT_LOCALE}
                    tone={i === 0 ? 'owed' : 'owe'}
                    countUp
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {/* Torn bottom edge */}
      <div
        aria-hidden
        className="h-3 bg-[radial-gradient(circle_at_8px_0,transparent_7px,var(--pl-sunken)_7.5px)] bg-[length:16px_12px] bg-repeat-x"
      />
    </div>
  )
}

function Planner({ phase, painted }: { phase: Phase; painted: number }) {
  const levels = HEAT.map((row, r) =>
    row.map((level, c) => {
      const index = r * DAYS.length + c
      const step = PAINT_ORDER.indexOf(index)
      return (step >= 0 && step < painted ? level : 0) as HeatLevel
    }),
  )
  const stamped = phase === 'stamp'
  return (
    <div className="relative w-[17rem] rotate-[3deg] rounded-[1.125rem] bg-card p-4 shadow-sheet sm:w-[19rem]">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-xl leading-none">{t('app.landing.demo.grid')}</p>
        <div className="flex -space-x-2">
          {PEOPLE.map((p) => (
            <Face key={p.id} id={p.id} name={p.name} size="sm" />
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1.5rem_repeat(5,minmax(0,1fr))] gap-1 text-[0.625rem] font-semibold text-mute">
        <span />
        {DAYS.map((d) => (
          <span key={d} className="text-center">
            {t(`app.landing.demo.days.${d}`)}
          </span>
        ))}
        {HOURS.map((hour, r) => (
          <div key={hour} className="contents">
            <span className="self-center text-right tabular">{hour}p</span>
            {DAYS.map((day, c) => (
              <HeatCell
                key={day}
                level={levels[r]![c]!}
                selected={stamped && r === BEST.row && c === BEST.col}
                className="h-7"
              />
            ))}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute -right-5 -bottom-6">
        <StampAnimation show={stamped} rotate={-10}>
          <Stamp caption={t('app.landing.demo.lockedWhen')} className="bg-card/90 text-lg">
            {t('app.landing.demo.locked')}
          </Stamp>
        </StampAnimation>
      </div>
    </div>
  )
}

/**
 * The hero's live demo: a dinner bill lands and splits four ways, then the group paints a
 * week and Thursday gets stamped. Loops; reduced motion shows the finished table.
 */
export function HeroDemo() {
  const reduced = usePrefersReducedMotion()
  const { phase, painted, cycle } = usePhase(reduced)
  return (
    <figure
      className="relative mx-auto h-[40rem] w-full max-w-[34rem] lg:h-[39rem]"
      aria-label={t('app.landing.demo.label')}
    >
      <div aria-hidden className="absolute top-0 left-0 sm:left-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={cycle}
            initial={reduced ? false : { opacity: 0, y: -30, rotate: -10 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          >
            <Receipt phase={phase} cycle={cycle} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div aria-hidden className="absolute right-0 bottom-0 sm:right-2">
        <motion.div
          animate={{
            scale: reached(phase, 'paint') ? 1 : 0.97,
            opacity: reached(phase, 'paint') ? 1 : 0.85,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        >
          <Planner phase={phase} painted={painted} />
        </motion.div>
      </div>
    </figure>
  )
}
