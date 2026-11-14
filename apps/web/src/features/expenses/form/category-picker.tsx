import {
  CATEGORIES,
  isCategory,
  parentCategory,
  subcategoriesOf,
  type CategoryId,
} from '@potluck/core'
import { t } from '@potluck/i18n'
import { cn, usePrefersReducedMotion } from '@potluck/ui'
import { AnimatePresence, motion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { categoryLabel } from '../format'

export interface CategoryPickerProps {
  /** The stored category (top level or subcategory), or null for none. */
  value: string | null
  onChange: (category: CategoryId | null) => void
  /** True while `value` follows the description rather than a tap. */
  suggested?: boolean
}

const chip =
  'inline-flex shrink-0 items-center gap-1.5 rounded-pill border font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96]'

/** The chip an arrow key, Home or End moves to from `index`, wrapping around; null for other keys. */
function arrowTarget(key: string, index: number, count: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * Category chips as a radio group, with a second row of subcategories under the picked one.
 * Tapping the picked category again clears it; tapping it while one of its subcategories is
 * picked goes back to the category itself.
 *
 * Each row is one Tab stop (the picked chip, else the first) and the arrow keys move along it
 * and pick, like any radio group, so the form is not sixteen Tab presses long.
 */
export function CategoryPicker({ value, onChange, suggested = false }: CategoryPickerProps) {
  const reduced = usePrefersReducedMotion()
  const subRowId = useId()
  const hintId = useId()
  const known = isCategory(value) ? value : null
  const parent = known ? parentCategory(known) : null
  const subs = parent ? subcategoriesOf(parent) : []
  const showSuggested = suggested && known !== null
  const rowRef = useRef<HTMLDivElement>(null)
  const mainStop = Math.max(
    0,
    CATEGORIES.findIndex((c) => c.id === parent),
  )
  const subStop = Math.max(
    0,
    subs.findIndex((c) => c.id === known),
  )
  const onArrow =
    (index: number, ids: readonly CategoryId[]) => (e: KeyboardEvent<HTMLButtonElement>) => {
      const next = arrowTarget(e.key, index, ids.length)
      if (next === null) return
      e.preventDefault()
      onChange(ids[next]!)
      // The chips of this row, in order; the picked one becomes the row's Tab stop.
      e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
    }
  const mainIds = CATEGORIES.map((c) => c.id)
  const subIds = subs.map((c) => c.id)

  // On a phone the chips scroll sideways: bring the picked one into view when it changes,
  // so a suggestion never lands off screen.
  useEffect(() => {
    const row = rowRef.current
    const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!row || !chip || row.scrollWidth <= row.clientWidth) return
    const box = row.getBoundingClientRect()
    const at = chip.getBoundingClientRect()
    if (at.left < box.left || at.right > box.right) {
      row.scrollBy({ left: at.left - box.left - 16, behavior: reduced ? 'auto' : 'smooth' })
    }
  }, [parent, reduced])

  return (
    <fieldset
      className="flex min-w-0 flex-col gap-2"
      aria-describedby={showSuggested ? hintId : undefined}
    >
      <legend className="mb-2 flex w-full items-center justify-between gap-2 text-sm font-semibold text-ink">
        <span>{t('categories.label')}</span>
        <AnimatePresence initial={false}>
          {showSuggested && (
            <motion.span
              key="suggested"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={
                reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 32 }
              }
              className="inline-flex items-center gap-1 rounded-pill bg-saffron-soft px-2 py-0.5 text-xs font-bold text-saffron-ink"
            >
              <Sparkles aria-hidden className="size-3" />
              {t('categories.suggested')}
            </motion.span>
          )}
        </AnimatePresence>
      </legend>
      <p id={hintId} role="status" className="sr-only">
        {showSuggested ? `${t('categories.suggestedHint')} ${categoryLabel(known)}` : ''}
      </p>
      <div
        ref={rowRef}
        role="radiogroup"
        aria-label={t('categories.label')}
        className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {CATEGORIES.map((c, index) => {
          const checked = parent === c.id
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === mainStop ? 0 : -1}
              onKeyDown={onArrow(index, mainIds)}
              aria-controls={checked && subs.length > 0 ? subRowId : undefined}
              onClick={() => onChange(checked && known === c.id ? null : c.id)}
              className={cn(
                chip,
                'h-9 px-3 text-sm',
                checked
                  ? suggested
                    ? 'border-saffron bg-saffron-soft text-ink'
                    : 'border-ink bg-ink text-paper'
                  : 'border-line-strong bg-card text-ink hover:border-ink/40',
              )}
            >
              <span aria-hidden className="text-base leading-none">
                {c.emoji}
              </span>
              {categoryLabel(c.id)}
            </button>
          )
        })}
      </div>
      <AnimatePresence initial={false}>
        {parent && subs.length > 0 && (
          <motion.div
            key={parent}
            id={subRowId}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={
              reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 32 }
            }
            role="radiogroup"
            aria-label={t('categories.subLabel')}
            className="-mx-4 flex [scrollbar-width:none] items-center gap-1.5 overflow-x-auto border-l-2 border-line-strong px-4 pb-1 sm:mx-0 sm:ml-1 sm:flex-wrap sm:overflow-visible sm:pr-0 sm:pb-0 sm:pl-3 [&::-webkit-scrollbar]:hidden"
          >
            <span className="mr-1 shrink-0 text-xs font-semibold text-mute">
              {t('categories.subLabel')}
            </span>
            {subs.map((s, index) => {
              const checked = known === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={index === subStop ? 0 : -1}
                  onKeyDown={onArrow(index, subIds)}
                  onClick={() => onChange(checked ? parent : s.id)}
                  className={cn(
                    chip,
                    'h-8 px-2.5 text-[0.8125rem]',
                    checked
                      ? suggested
                        ? 'border-saffron bg-saffron-soft text-ink'
                        : 'border-ink bg-ink text-paper'
                      : 'border-line bg-sunken text-ink hover:border-ink/40',
                  )}
                >
                  <span aria-hidden className="text-sm leading-none">
                    {s.emoji}
                  </span>
                  {categoryLabel(s.id)}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </fieldset>
  )
}
