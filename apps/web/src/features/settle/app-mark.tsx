import type { PaymentKind } from '@potluck/core'
import { t } from '@potluck/i18n'
import { cn } from '@potluck/ui'
import { Landmark } from 'lucide-react'

/** Palette tones only: no brand logos or brand colors (they are not ours to use). */
const TONES: Record<PaymentKind, string> = {
  paypal: 'bg-plum-soft text-plum-ink',
  venmo: 'bg-saffron-soft text-saffron-ink',
  cashapp: 'bg-olive-soft text-olive-ink',
  revolut: 'bg-sunken text-ink',
  monzo: 'bg-tomato-soft text-tomato-ink',
  upi: 'bg-plum-soft text-plum-ink',
  interac: 'bg-saffron-soft text-saffron-ink',
  bank: 'bg-olive-soft text-olive-ink',
}

/** A small tile with the app's initial, for lists of payment methods. */
export function AppMark({ kind, className }: { kind: PaymentKind; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-[0.75rem] font-display text-xl leading-none',
        TONES[kind],
        className,
      )}
    >
      {kind === 'bank' ? <Landmark className="size-5" /> : t(`settle.apps.${kind}`).charAt(0)}
    </span>
  )
}
