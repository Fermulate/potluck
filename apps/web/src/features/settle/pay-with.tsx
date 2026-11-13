import { paymentQueries, type MoneyMember } from '@potluck/api'
import { firstName, payableMethods, paymentAction, type PaymentMethod } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { Button, Card, ConfirmDialog, Skeleton, toast } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { copyText } from '@/features/invites/share'
import { GoodToKnow } from '@/features/help/help'
import { supabase } from '@/lib/supabase'
import { AppMark } from './app-mark'

/**
 * The recipient's saved payment methods as buttons. A link opens their app with the amount
 * filled in; Potluck never sees the money move, so it asks "Did it go through?" and records the
 * payment only on yes. Interac and bank details have no link: they get a copy button.
 */
export function PayWith({
  recipient,
  amountCents,
  currency,
  note,
  onConfirmed,
}: {
  recipient: MoneyMember
  /** Null until an amount is typed. */
  amountCents: number | null
  currency: string
  note?: string
  /** Called after "Yes, record it". */
  onConfirmed: () => void
}) {
  const methods = useQuery(paymentQueries.methods(supabase, recipient.id))
  const [asking, setAsking] = useState<string | null>(null)
  const name = firstName(recipient.display_name)

  if (methods.isPending) return <Skeleton className="h-24" />
  const shown = payableMethods(methods.data ?? [], currency)
  if (shown.length === 0) return null

  const amount = amountCents && amountCents > 0 ? amountCents : 0
  const formatted = amount ? formatMoney(amount, currency) : ''

  return (
    <section aria-labelledby="pay-with-title" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 id="pay-with-title" className="text-sm font-bold text-mute">
          {t('settle.payWithTitle', { name })}
        </h2>
        <GoodToKnow topic="paymentLinks" tip="paymentLinks" align="start" />
      </div>
      <Card padding="none" className="overflow-hidden">
        <ul className="divide-y divide-line">
          {shown.map((m) => {
            const app = t(`settle.apps.${m.kind}`)
            const action = paymentAction(m as PaymentMethod, {
              amountCents: amount,
              currency,
              note,
              payeeName: recipient.display_name,
            })
            if (action.type === 'copy') {
              return (
                <li key={m.kind} className="flex items-center gap-3 px-4 py-3">
                  <AppMark kind={m.kind} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold">{app}</span>
                    <span className="truncate text-[0.9375rem] break-all select-all">
                      {m.handle}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<Copy />}
                    aria-label={t('settle.copyLabel', { name, app })}
                    onClick={() =>
                      void copyText(m.handle).then((ok) => ok && toast.success(t('settle.copied')))
                    }
                  >
                    {t('settle.copy')}
                  </Button>
                </li>
              )
            }
            return (
              <li key={m.kind} className="flex items-center gap-3 px-4 py-3">
                <AppMark kind={m.kind} />
                <span className="min-w-0 flex-1 text-sm text-mute">
                  {amount
                    ? action.prefilled
                      ? t('settle.payWithPrefilled', { app, amount: formatted })
                      : t('settle.payWithManual', { app, amount: formatted })
                    : app}
                </span>
                <Button
                  asChild
                  size="sm"
                  variant="ink"
                  className={amount ? undefined : 'pointer-events-none opacity-50'}
                >
                  <a
                    href={action.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-disabled={!amount || undefined}
                    onClick={(e) => {
                      if (!amount) {
                        e.preventDefault()
                        return
                      }
                      setAsking(m.kind)
                    }}
                  >
                    {t('settle.payWith', { app })}
                    <ExternalLink aria-hidden className="-mr-1 size-4" />
                  </a>
                </Button>
              </li>
            )
          })}
        </ul>
      </Card>
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={t('settle.confirmTitle')}
        description={t('settle.confirmBody', {
          app: asking ? t(`settle.apps.${asking as PaymentMethod['kind']}`) : '',
        })}
        confirmLabel={t('settle.confirmYes')}
        cancelLabel={t('settle.confirmNo')}
        closeLabel={t('common.close')}
        onConfirm={() => {
          setAsking(null)
          onConfirmed()
        }}
      />
    </section>
  )
}
