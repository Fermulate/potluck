import { moneyQueries } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Sheet, SheetContent, Skeleton, cn } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'

let names: Intl.DisplayNames | null = null
function currencyName(code: string): string {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'currency' })
    return names.of(code) ?? code
  } catch {
    return code
  }
}

function symbol(code: string): string {
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? code
  )
}

/**
 * Pick the currency an expense was paid in. Only currencies with a known rate into the group
 * currency are offered, because the server needs one to save.
 */
export function CurrencyPicker({
  open,
  onOpenChange,
  value,
  groupCurrency,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  groupCurrency: string
  onSelect: (code: string) => void
}) {
  const { data, isPending } = useQuery({
    ...moneyQueries.fxCurrencies(supabase, groupCurrency),
    enabled: open,
  })

  const row = (code: string) => {
    const selected = code === value
    return (
      <li key={code}>
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => {
            onSelect(code)
            onOpenChange(false)
          }}
          className={cn(
            'flex w-full items-center gap-3 rounded-[0.875rem] px-3 py-2.5 text-left transition-colors hover:bg-sunken',
            selected && 'bg-sunken',
          )}
        >
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-saffron-soft text-base font-bold text-saffron-ink"
          >
            {symbol(code)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{code}</span>
            <span className="truncate text-sm text-mute">{currencyName(code)}</span>
          </span>
          {selected && <Check aria-hidden className="size-5 text-olive-ink" strokeWidth={3} />}
        </button>
      </li>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('expenses.currencyPicker.title')}
        closeLabel={t('common.close')}
        size="sm"
      >
        <h3 className="mt-1 mb-1 px-3 text-xs font-bold text-mute">
          {t('expenses.currencyPicker.groupCurrency')}
        </h3>
        <ul>{row(groupCurrency)}</ul>
        <h3 className="mt-4 mb-1 px-3 text-xs font-bold text-mute">
          {t('expenses.currencyPicker.others')}
        </h3>
        {isPending ? (
          <div aria-busy="true" className="flex flex-col gap-2 px-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <ul>{data.map(row)}</ul>
        ) : (
          <p className="px-3 text-sm text-mute">{t('expenses.currencyPicker.noRate')}</p>
        )}
      </SheetContent>
    </Sheet>
  )
}
