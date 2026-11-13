import {
  paymentKeys,
  paymentQueries,
  removePaymentMethod,
  savePaymentMethod,
  type SavedPaymentMethod,
} from '@potluck/api'
import { PAYMENT_KINDS, isValidHandle, normalizeHandle, type PaymentKind } from '@potluck/core'
import { t } from '@potluck/i18n'
import {
  Button,
  Card,
  Field,
  IconButton,
  Input,
  Sheet,
  SheetContent,
  Skeleton,
  cn,
  toast,
} from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PencilLine, Plus, Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Help } from '@/features/help/help'
import { AppMark } from '@/features/settle/app-mark'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** Text shown before the field, so people type just their handle. */
const PREFIX: Partial<Record<PaymentKind, string>> = {
  paypal: 'paypal.me/',
  venmo: '@',
  cashapp: '$',
  revolut: 'revolut.me/',
  monzo: 'monzo.me/',
}

/**
 * Me, Payment methods: where people in your groups can pay you. The settle up screen turns these
 * into "Pay with ..." buttons for whoever owes you.
 */
export function PaymentMethodsSection() {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const methods = useQuery(paymentQueries.methods(supabase, userId))
  const [editing, setEditing] = useState<{ kind: PaymentKind | null; handle: string } | null>(null)

  const remove = useMutation({
    mutationFn: (kind: PaymentKind) => removePaymentMethod(supabase, userId, kind),
    onSuccess: (_v, kind) =>
      toast.success(t('settings.paymentMethods.removed', { app: t(`settle.apps.${kind}`) })),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: paymentKeys.methods(userId) }),
  })

  return (
    <section aria-labelledby="me-payment-methods" className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="me-payment-methods" className="text-sm font-bold text-mute">
          {t('settings.paymentMethods.title')}
        </h2>
        <Help topic="paymentMethods" />
      </div>
      <Card padding="roomy" className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <p className="text-sm text-mute">{t('settings.paymentMethods.hint')}</p>
        {methods.isPending ? (
          <Skeleton className="h-14" />
        ) : (
          methods.data &&
          methods.data.length > 0 && (
            <ul className="-mx-2 divide-y divide-line">
              {methods.data.map((m: SavedPaymentMethod) => {
                const app = t(`settle.apps.${m.kind}`)
                return (
                  <li key={m.kind} className="flex items-center gap-3 px-2 py-2.5">
                    <AppMark kind={m.kind} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{app}</span>
                      <span className="truncate text-sm text-mute">
                        {PREFIX[m.kind] ?? ''}
                        {m.handle}
                      </span>
                    </span>
                    <IconButton
                      size="sm"
                      label={t('settings.paymentMethods.edit', { app })}
                      icon={<PencilLine />}
                      onClick={() => setEditing({ kind: m.kind, handle: m.handle })}
                    />
                    <IconButton
                      size="sm"
                      label={t('settings.paymentMethods.remove', { app })}
                      icon={<Trash2 />}
                      onClick={() => remove.mutate(m.kind)}
                    />
                  </li>
                )
              })}
            </ul>
          )
        )}
        <Button
          variant="secondary"
          leadingIcon={<Plus />}
          className="justify-self-start"
          onClick={() => setEditing({ kind: null, handle: '' })}
        >
          {t('settings.paymentMethods.add')}
        </Button>
      </Card>
      {editing && (
        <MethodSheet
          initialKind={editing.kind}
          initialHandle={editing.handle}
          taken={methods.data?.map((m) => m.kind) ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function MethodSheet({
  initialKind,
  initialHandle,
  taken,
  onClose,
}: {
  initialKind: PaymentKind | null
  initialHandle: string
  taken: PaymentKind[]
  onClose: () => void
}) {
  const userId = useUserId()
  const formId = useId()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<PaymentKind>(
    initialKind ?? PAYMENT_KINDS.find((k) => !taken.includes(k)) ?? 'paypal',
  )
  const [raw, setRaw] = useState(initialHandle)
  const [submitted, setSubmitted] = useState(false)
  const handle = normalizeHandle(kind, raw)
  const app = t(`settle.apps.${kind}`)
  const valid = isValidHandle(kind, handle)
  const error = submitted && !valid ? t('settings.paymentMethods.invalid', { app }) : undefined

  const save = useMutation({
    mutationFn: () => savePaymentMethod(supabase, { kind, handle }),
    onSuccess: () => {
      toast.success(t('settings.paymentMethods.saved', { app }))
      void queryClient.invalidateQueries({ queryKey: paymentKeys.methods(userId) })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (valid) save.mutate()
  }

  const prefix = PREFIX[kind]
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={
          initialKind
            ? t('settings.paymentMethods.edit', { app })
            : t('settings.paymentMethods.add')
        }
        closeLabel={t('common.close')}
        footer={
          <Button type="submit" form={formId} block size="lg" loading={save.isPending}>
            {t('settings.paymentMethods.save')}
          </Button>
        }
      >
        <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-5">
          {!initialKind && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-semibold">
                {t('settings.paymentMethods.pickApp')}
              </legend>
              <div role="radiogroup" className="flex flex-wrap gap-2">
                {PAYMENT_KINDS.map((k) => {
                  const checked = k === kind
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => setKind(k)}
                      className={cn(
                        'inline-flex h-9 items-center rounded-pill border px-3 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96]',
                        checked
                          ? 'border-ink bg-ink text-paper'
                          : 'border-line-strong bg-card text-ink hover:border-ink/40',
                      )}
                    >
                      {t(`settle.apps.${k}`)}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}
          <Field
            label={t(`settings.paymentMethods.handle.${kind}`)}
            hint={prefix ? t('settings.paymentMethods.pasteHint') : undefined}
            error={error}
          >
            <Input
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t(`settings.paymentMethods.placeholder.${kind}`)}
              leading={prefix ? <span className="text-base font-medium">{prefix}</span> : undefined}
              // Room for the prefix: about 0.55em per character plus the left inset.
              style={prefix ? { paddingLeft: `${1.4 + prefix.length * 0.55}rem` } : undefined}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              maxLength={256}
              autoFocus
            />
          </Field>
        </form>
      </SheetContent>
    </Sheet>
  )
}
