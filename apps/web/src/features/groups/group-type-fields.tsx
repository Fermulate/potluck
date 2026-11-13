import {
  GROUP_TYPES,
  checkTripDates,
  groupTypeEmoji,
  typeHasDates,
  type GroupType,
} from '@potluck/core'
import { t } from '@potluck/i18n'
import { cn, Field, Input, usePrefersReducedMotion } from '@potluck/ui'
import { AnimatePresence, motion } from 'motion/react'
import { useId } from 'react'

/** Home, Trip, Couple, Other as a two by two radio grid. */
export function GroupTypePicker({
  value,
  onChange,
}: {
  value: GroupType
  onChange: (type: GroupType) => void
}) {
  const name = useId()
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{t('groups.types.label')}</legend>
      <div className="grid grid-cols-2 gap-2">
        {GROUP_TYPES.map((type) => {
          const checked = value === type
          return (
            <label
              key={type}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-[0.875rem] border p-3 transition-[border-color,background-color,transform] duration-150 active:scale-[0.98] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                checked
                  ? 'border-ink bg-saffron-soft/60'
                  : 'border-line-strong bg-card hover:border-ink/40',
              )}
            >
              <input
                type="radio"
                name={name}
                value={type}
                checked={checked}
                onChange={() => onChange(type)}
                className="sr-only"
              />
              <span aria-hidden className="pt-0.5 text-2xl leading-none">
                {groupTypeEmoji(type)}
              </span>
              <span className="min-w-0">
                <span className="block text-[0.9375rem] font-bold">
                  {t(`groups.types.${type}`)}
                </span>
                <span className="block text-xs leading-snug text-mute">
                  {t(`groups.types.${type}Hint`)}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** First and last day of a trip; both optional. Shown only for trips. */
export function TripDatesFields({
  type,
  startsOn,
  endsOn,
  onChange,
}: {
  type: GroupType
  startsOn: string
  endsOn: string
  onChange: (dates: { startsOn: string; endsOn: string }) => void
}) {
  const reduced = usePrefersReducedMotion()
  const problem = checkTripDates(startsOn || null, endsOn || null)
  return (
    <AnimatePresence initial={false}>
      {typeHasDates(type) && (
        <motion.div
          key="dates"
          initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={
            reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 32 }
          }
          className="overflow-hidden"
        >
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Field label={t('groups.trip.starts')} hint={t('groups.trip.datesHint')}>
              <Input
                type="date"
                value={startsOn}
                onChange={(e) => onChange({ startsOn: e.target.value, endsOn })}
              />
            </Field>
            <Field
              label={t('groups.trip.ends')}
              error={problem ? t('groups.trip.endBeforeStart') : undefined}
            >
              <Input
                type="date"
                value={endsOn}
                min={startsOn || undefined}
                onChange={(e) => onChange({ startsOn, endsOn: e.target.value })}
              />
            </Field>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
