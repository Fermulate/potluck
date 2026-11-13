import { isRate, trimRate, type MissingRate } from '@potluck/core'
import { formatDate, formatRate, t } from '@potluck/i18n'
import { Button, Card, Checkbox, Field, Input } from '@potluck/ui'
import { AlertTriangle, Check } from 'lucide-react'
import { useState } from 'react'

/**
 * A rate far from Potluck's own (or with nothing to compare it with): `import_expenses` refuses it
 * until the person ticks that it is right.
 */
export function FarRate({
  text,
  confirmed,
  onConfirm,
}: {
  text: string
  confirmed: boolean
  onConfirm: (confirmed: boolean) => void
}) {
  return (
    <div className="grid gap-2 rounded-card bg-saffron-soft p-3 text-sm text-saffron-ink">
      <p className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        {text}
      </p>
      <Checkbox
        label={t('transfer.import.rates.confirm')}
        checked={confirmed}
        onCheckedChange={(checked) => onConfirm(checked === true)}
      />
    </div>
  )
}

/**
 * One currency Potluck has no rate for on some days of the file: type a rate (kept as the text
 * typed, applied on leaving the field, Enter or Use this rate), or leave its rows out. A rate far
 * from the stored one nearest those days has to be confirmed; the server refuses it otherwise. A
 * currency Potluck has no rates for at all can only be left out.
 */
export function RateCard({
  missing,
  groupCurrency,
  check,
  confirmed,
  onApply,
  onSkip,
  onConfirm,
}: {
  missing: MissingRate
  groupCurrency: string
  /**
   * How the typed rate compares with Potluck's own: undefined while loading; `unsupported` when
   * Potluck has no rates for the currency; else whether it is far off and the stored rate it was
   * held against (null when there is none for the pair).
   */
  check:
    | { unsupported: true }
    | { unsupported: false; outlier: boolean; reference: string | null }
    | undefined
  confirmed: boolean
  onApply: (rate: string | null) => void
  onSkip: (skip: boolean) => void
  onConfirm: (confirmed: boolean) => void
}) {
  const [draft, setDraft] = useState(missing.typed ? formatRate(missing.typed) : '')
  const [invalid, setInvalid] = useState(false)
  const label = t('transfer.import.rates.typed', {
    currency: missing.currency,
    group: groupCurrency,
  })
  const unsupported = check?.unsupported === true

  function apply() {
    const text = draft.trim().replace(',', '.')
    if (text === '') {
      setInvalid(false)
      onApply(null)
      return
    }
    if (!isRate(text)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (text !== missing.typed) onConfirm(false)
    onApply(text)
  }

  const outlier = !!missing.typed && check?.unsupported === false && check.outlier
  const reference = check?.unsupported === false ? check.reference : null

  return (
    <Card padding="default" className="grid gap-3">
      <p className="text-sm">
        {t('transfer.import.rates.missing', {
          currency: missing.currency,
          group: groupCurrency,
          count: missing.rows,
          from: formatDate(missing.from, { timeZone: 'UTC' }),
          to: formatDate(missing.to, { timeZone: 'UTC' }),
        })}
      </p>
      {unsupported ? (
        <p className="flex items-start gap-2 rounded-card bg-saffron-soft p-3 text-sm text-saffron-ink">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('transfer.import.rates.unsupported', { currency: missing.currency })}
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label={label}
            error={
              invalid
                ? t('transfer.import.rates.invalid', { example: formatRate('0.0091') })
                : undefined
            }
            className="min-w-44 flex-1 sm:max-w-60"
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              value={draft}
              disabled={missing.skipped}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={apply}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  apply()
                }
              }}
            />
          </Field>
          <Button
            variant="secondary"
            className="h-12"
            disabled={missing.skipped}
            onMouseDown={(e) => e.preventDefault()}
            onClick={apply}
          >
            {t('transfer.import.rates.apply')}
          </Button>
        </div>
      )}
      {!unsupported && missing.typed && check && !outlier && (
        <p className="flex items-center gap-2 text-sm text-olive-ink">
          <Check aria-hidden className="size-4" />
          {t('transfer.import.rates.using', {
            currency: missing.currency,
            rate: formatRate(missing.typed),
            group: groupCurrency,
          })}
        </p>
      )}
      {outlier && (
        <FarRate
          text={
            reference
              ? t('transfer.import.rates.far', {
                  currency: missing.currency,
                  rate: formatRate(missing.typed!),
                  reference: formatRate(trimRate(reference)),
                  group: groupCurrency,
                })
              : t('transfer.import.rates.noReference', {
                  currency: missing.currency,
                  group: groupCurrency,
                })
          }
          confirmed={confirmed}
          onConfirm={onConfirm}
        />
      )}
      <Checkbox
        label={t('transfer.import.rates.skip')}
        checked={missing.skipped}
        onCheckedChange={(checked) => onSkip(checked === true)}
      />
    </Card>
  )
}
