import { t } from '@potluck/i18n'
import { Field, Input, Select } from '@potluck/ui'
import { formatMinuteOfDay } from './format'
import { addDays, windowDays, type PollWindow, type WindowField } from './window'

/**
 * The date range and daily hours of a poll, shared by plans and quick polls. Each control's id is
 * `<idPrefix>-<field>` so a form can focus the first one with an error. With `maxDays`, the last
 * day cannot be picked more than that many days after the first, and moving the first day pulls
 * the last one along.
 */
export function WindowFields({
  value,
  onChange,
  today,
  maxDays,
  errors = {},
  idPrefix,
}: {
  value: PollWindow
  onChange: (next: PollWindow) => void
  /** The earliest day to offer, `YYYY-MM-DD` in the viewer's zone. */
  today: string
  maxDays?: number
  errors?: Partial<Record<WindowField, string>>
  idPrefix: string
}) {
  const days = windowDays(value)
  const lastDay = (start: string) => (maxDays ? addDays(start, maxDays - 1) : undefined)
  const hourOptions = Array.from({ length: 49 }, (_, i) => i * 30).map((m) => ({
    value: String(m),
    label: formatMinuteOfDay(m),
  }))

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t('events.create.windowFrom')}
          error={errors.window_start}
          id={`${idPrefix}-window_start`}
        >
          <Input
            type="date"
            value={value.windowStart}
            min={today}
            onChange={(e) => {
              const start = e.target.value
              const last = lastDay(start)
              let end = value.windowEnd
              if (start > end) end = start
              else if (last && end > last) end = last
              onChange({ ...value, windowStart: start, windowEnd: end })
            }}
          />
        </Field>
        <Field
          label={t('events.create.windowTo')}
          error={errors.window_end}
          id={`${idPrefix}-window_end`}
        >
          <Input
            type="date"
            value={value.windowEnd}
            min={value.windowStart}
            max={lastDay(value.windowStart)}
            onChange={(e) => onChange({ ...value, windowEnd: e.target.value })}
          />
        </Field>
      </div>
      {days > 0 && (
        <p className="-mt-2 text-sm text-mute">{t('events.create.windowDays', { count: days })}</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('events.create.hoursFrom')}>
          <Select
            value={String(value.dayStartMinute)}
            onValueChange={(v) => onChange({ ...value, dayStartMinute: Number(v) })}
            options={hourOptions.slice(0, -1)}
          />
        </Field>
        <Field
          label={t('events.create.hoursTo')}
          error={errors.day_end_minute}
          id={`${idPrefix}-day_end_minute`}
        >
          <Select
            value={String(value.dayEndMinute)}
            onValueChange={(v) => onChange({ ...value, dayEndMinute: Number(v) })}
            options={hourOptions.slice(1)}
          />
        </Field>
      </div>
    </>
  )
}
