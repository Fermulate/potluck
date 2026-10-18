import { t } from '@potluck/i18n'
import { cn, controlClassName, Field, useField } from '@potluck/ui'
import { ChevronDown } from 'lucide-react'
import { useMemo } from 'react'
import { currencyCodes, currencyLabel, timezones } from '@/lib/locale'

/**
 * Native select for long lists (time zones, currencies): the platform picker is faster and
 * friendlier on phones than a custom listbox with hundreds of rows.
 */
function NativeSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  const field = useField()
  return (
    // Inline-size containment keeps a long option label from widening the layout.
    <div className="relative [contain:inline-size]">
      <select
        id={field?.id}
        aria-describedby={field?.describedBy}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(controlClassName, 'h-12 appearance-none pr-10')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-mute"
      />
    </div>
  )
}

function zoneLabel(zone: string): string {
  return zone.replaceAll('_', ' ').replaceAll('/', ' / ')
}

export function TimezoneField({
  value,
  onChange,
  label = t('onboarding.profile.timezoneLabel'),
  hint,
}: {
  value: string
  onChange: (zone: string) => void
  label?: string
  hint?: string
}) {
  const options = useMemo(() => {
    const zones = timezones()
    const list = zones.includes(value) ? zones : [value, ...zones]
    return list.map((zone) => ({ value: zone, label: zoneLabel(zone) }))
  }, [value])
  return (
    <Field label={label} hint={hint}>
      <NativeSelect value={value} onChange={onChange} options={options} />
    </Field>
  )
}

export function CurrencyField({
  value,
  onChange,
  label = t('onboarding.profile.currencyLabel'),
  hint,
  disabled,
}: {
  value: string
  onChange: (code: string) => void
  label?: string
  hint?: string
  disabled?: boolean
}) {
  const options = useMemo(() => {
    const codes = currencyCodes()
    const list = codes.includes(value) ? codes : [value, ...codes]
    return list.map((code) => ({ value: code, label: currencyLabel(code) }))
  }, [value])
  return (
    <Field label={label} hint={hint}>
      <NativeSelect value={value} onChange={onChange} options={options} disabled={disabled} />
    </Field>
  )
}
