import { isRate, rateIsOutlier, trimRate, type MissingRate } from '@potluck/core'
import { formatDate, t } from '@potluck/i18n'
import { Button, Card, Checkbox, Field, Input } from '@potluck/ui'
import { AlertTriangle, Check } from 'lucide-react'
import { useState } from 'react'

/**
 * One currency Potluck has no rate for on some days of the file: type a rate (kept as the exact
 * text typed, applied on leaving the field, Enter or Use this rate), or leave its rows out. A rate
 * far from Potluck's latest one for the pair has to be confirmed; the server refuses it otherwise.
 */
export function RateCard({
  missing,
  groupCurrency,
  reference,
  confirmed,
  onApply,
  onSkip,
  onConfirm,
}: {
  missing: MissingRate
  groupCurrency: string
  /** Potluck's latest rate for the pair; null when it has none, undefined while loading. */
  reference: string | null | undefined
  confirmed: boolean
  onApply: (rate: string | null) => void
  onSkip: (skip: boolean) => void
  onConfirm: (confirmed: boolean) => void
}) {
  const [draft, setDraft] = useState(missing.typed ?? '')
  const [invalid, setInvalid] = useState(false)
  const label = t('transfer.import.rates.typed', {
    currency: missing.currency,
    group: groupCurrency,
  })

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
    setDraft(text)
    if (text !== missing.typed) onConfirm(false)
    onApply(text)
  }

  const outlier =
    !!missing.typed && reference !== undefined && rateIsOutlier(missing.typed, reference)

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
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label={label}
          error={invalid ? t('transfer.import.rates.invalid') : undefined}
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
      {missing.typed && !outlier && (
        <p className="flex items-center gap-2 text-sm text-olive-ink">
          <Check aria-hidden className="size-4" />
          {t('transfer.import.rates.using', {
            currency: missing.currency,
            rate: missing.typed,
            group: groupCurrency,
          })}
        </p>
      )}
      {outlier && (
        <div className="grid gap-2 rounded-card bg-saffron-soft p-3 text-sm text-saffron-ink">
          <p className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {reference
              ? t('transfer.import.rates.far', {
                  currency: missing.currency,
                  rate: missing.typed!,
                  reference: trimRate(reference),
                  group: groupCurrency,
                })
              : t('transfer.import.rates.noReference', {
                  currency: missing.currency,
                  group: groupCurrency,
                })}
          </p>
          <Checkbox
            label={t('transfer.import.rates.confirm')}
            checked={confirmed}
            onCheckedChange={(checked) => onConfirm(checked === true)}
          />
        </div>
      )}
      <Checkbox
        label={t('transfer.import.rates.skip')}
        checked={missing.skipped}
        onCheckedChange={(checked) => onSkip(checked === true)}
      />
    </Card>
  )
}
