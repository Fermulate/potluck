import { parseReceipt, receiptDateOrder, type ReceiptScan } from '@potluck/core'
import { formatDate, formatMoney, intlLocale, t } from '@potluck/i18n'
import {
  Button,
  Checkbox,
  ProgressRing,
  Sheet,
  SheetContent,
  cn,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { motion } from 'motion/react'
import { ScanLine } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Help } from '@/features/help/help'
import { todayIn } from '../format'
import type { SplitDraft } from '../form/split-state'
import { Money } from '../money'
import { draftFromFile, type AttachmentDraft } from './attachments-state'
import { prepareImage } from './image'
import { ReaderUnavailableError, readReceiptText, type ReadStage } from './ocr'
import {
  defaultChoice,
  fillFromScan,
  scanFoundSomething,
  scanItemsTotal,
  type ScanChoice,
  type ScanFill,
} from './scan-fill'

export interface ScanResult {
  fill: ScanFill
  /** The photo to attach, when the person kept that box ticked. */
  photo: AttachmentDraft | null
}

type State =
  | { phase: 'idle' }
  | { phase: 'reading'; photo: File; url: string; stage: ReadStage; progress: number }
  | {
      phase: 'review'
      photo: File
      url: string
      scan: ReceiptScan
      choice: ScanChoice
      attach: boolean
    }
  | { phase: 'empty'; photo: File; url: string }
  | { phase: 'failed'; reason: 'offline' | 'failed' }

/**
 * "Scan a receipt": a photo is read on the device and what it says is offered for the expense
 * form, part by part. It only ever fills the form; saving stays with the person (ADR 21).
 */
export function ScanReceipt({
  currency,
  description,
  draft,
  memberIds,
  timeZone,
  canAttach,
  onApply,
}: {
  currency: string
  description: string
  draft: SplitDraft
  memberIds: string[]
  timeZone: string
  canAttach: boolean
  onApply: (result: ScanResult) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [state, setState] = useState<State>({ phase: 'idle' })
  const url = 'url' in state ? state.url : null
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )
  useEffect(() => () => abortRef.current?.abort(), [])

  const read = async (picked: File) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const photo = await prepareImage(picked)
    const photoUrl = URL.createObjectURL(photo)
    setState({ phase: 'reading', photo, url: photoUrl, stage: 'loading', progress: 0 })
    try {
      const text = await readReceiptText(photo, {
        signal: controller.signal,
        onProgress: ({ stage, progress }) =>
          setState((s) => (s.phase === 'reading' ? { ...s, stage, progress } : s)),
      })
      const scan = parseReceipt(text, {
        currency,
        dateOrder: receiptDateOrder(currency, intlLocale()),
        today: todayIn(timeZone),
      })
      setState(
        scanFoundSomething(scan)
          ? {
              phase: 'review',
              photo,
              url: photoUrl,
              scan,
              choice: defaultChoice(scan, description),
              attach: canAttach,
            }
          : { phase: 'empty', photo, url: photoUrl },
      )
    } catch (error) {
      if (controller.signal.aborted) return
      URL.revokeObjectURL(photoUrl)
      setState({
        phase: 'failed',
        reason: error instanceof ReaderUnavailableError && !navigator.onLine ? 'offline' : 'failed',
      })
    }
  }

  const close = () => {
    abortRef.current?.abort()
    setState({ phase: 'idle' })
  }
  const pickAgain = () => inputRef.current?.click()
  const attachDraft = (photo: File, attach: boolean) => (attach ? draftFromFile(photo) : null)

  const apply = () => {
    if (state.phase !== 'review') return
    onApply({
      fill: fillFromScan(state.scan, state.choice, { draft, currency, memberIds }),
      photo: attachDraft(state.photo, state.attach && canAttach),
    })
    setState({ phase: 'idle' })
  }

  const footer =
    state.phase === 'reading' ? (
      <Button variant="secondary" className="w-full" onClick={close}>
        {t('expenses.scan.stop')}
      </Button>
    ) : state.phase === 'review' ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={pickAgain}>
          {t('expenses.scan.again')}
        </Button>
        <Button onClick={apply}>{t('expenses.scan.apply')}</Button>
      </div>
    ) : state.phase === 'empty' ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={pickAgain}>
          {t('expenses.scan.again')}
        </Button>
        {canAttach && (
          <Button
            onClick={() => {
              onApply({ fill: {}, photo: attachDraft(state.photo, true) })
              setState({ phase: 'idle' })
            }}
          >
            {t('expenses.scan.attachOnly')}
          </Button>
        )}
      </div>
    ) : state.phase === 'failed' ? (
      <Button className="w-full" onClick={pickAgain}>
        {t('expenses.scan.again')}
      </Button>
    ) : null

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void read(file)
        }}
      />
      <span className="inline-flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<ScanLine />}
          onClick={pickAgain}
          className="bg-card"
        >
          {t('expenses.scan.button')}
        </Button>
        <Help topic="receiptScan" />
      </span>
      <Sheet open={state.phase !== 'idle'} onOpenChange={(open) => !open && close()}>
        <SheetContent
          title={
            state.phase === 'review' ? t('expenses.scan.reviewTitle') : t('expenses.scan.title')
          }
          description={
            state.phase === 'review' ? t('expenses.scan.reviewHint') : t('expenses.scan.private')
          }
          closeLabel={t('common.close')}
          footer={footer}
        >
          {state.phase === 'reading' && (
            <Reading url={state.url} stage={state.stage} progress={state.progress} />
          )}
          {state.phase === 'review' && (
            <Review
              scan={state.scan}
              choice={state.choice}
              formCurrency={currency}
              timeZone={timeZone}
              onChoice={(choice) => setState({ ...state, choice })}
              attach={state.attach}
              canAttach={canAttach}
              onAttach={(attach) => setState({ ...state, attach })}
            />
          )}
          {state.phase === 'empty' && (
            <Message url={state.url}>{t('expenses.scan.nothing')}</Message>
          )}
          {state.phase === 'failed' && (
            <Message>
              {state.reason === 'offline' ? t('expenses.scan.offline') : t('expenses.scan.failed')}
            </Message>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

/** The photo under a sweeping line while the reader works. */
function Reading({ url, stage, progress }: { url: string; stage: ReadStage; progress: number }) {
  const reduced = usePrefersReducedMotion()
  const percent = Math.round(progress * 100)
  const label = stage === 'loading' ? t('expenses.scan.loading') : t('expenses.scan.reading')
  return (
    <div className="flex flex-col items-center gap-5 pt-2" aria-live="polite">
      <div className="relative w-full max-w-[16rem] overflow-hidden rounded-card border border-line bg-sunken">
        <img src={url} alt="" className="max-h-72 w-full object-contain" />
        {!reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-saffron/50 to-transparent"
            initial={{ y: '-100%' }}
            animate={{ y: ['-40%', '1800%'] }}
            transition={{
              duration: 2.2,
              repeat: Infinity,
              repeatType: 'reverse',
              ease: 'easeInOut',
            }}
          />
        )}
      </div>
      <div className="flex items-center gap-3">
        <ProgressRing
          value={stage === 'reading' ? progress : 0}
          label={label}
          valueText={t('expenses.scan.percent', { percent: stage === 'reading' ? percent : 0 })}
          size={44}
          tone="saffron"
        />
        <div className="flex flex-col">
          <span className="font-semibold">{label}</span>
          {stage === 'loading' ? (
            <span className="text-sm text-mute">{t('expenses.scan.loadingHint')}</span>
          ) : (
            <span className="tabular text-sm text-mute">
              {t('expenses.scan.percent', { percent })}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function Message({ url, children }: { url?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 pt-2 text-center">
      {url ? (
        <img
          src={url}
          alt=""
          className="max-h-48 rounded-card border border-line bg-sunken object-contain"
        />
      ) : (
        <span aria-hidden className="text-5xl">
          🧾
        </span>
      )}
      <p role="status" className="max-w-sm text-[0.9375rem] text-balance">
        {children}
      </p>
    </div>
  )
}

/**
 * What the receipt says, set like a till roll: one box per part, so a misread date or a wrong
 * total can be left out while the rest is used.
 */
function Review({
  scan,
  choice,
  formCurrency,
  timeZone,
  onChoice,
  attach,
  canAttach,
  onAttach,
}: {
  scan: ReceiptScan
  choice: ScanChoice
  formCurrency: string
  timeZone: string
  onChoice: (choice: ScanChoice) => void
  attach: boolean
  canAttach: boolean
  onAttach: (attach: boolean) => void
}) {
  const id = useId()
  const currency = scan.currency ?? formCurrency
  const itemsTotal = useMemo(() => scanItemsTotal(scan), [scan])
  const off = scan.totalCents !== null && scan.items.length > 0 && itemsTotal !== scan.totalCents
  const toggle = (key: keyof ScanChoice) => (on: boolean | 'indeterminate') =>
    onChoice({ ...choice, [key]: on === true })

  const row = (part: keyof ScanChoice, label: ReactNode, value?: ReactNode, strong = false) => (
    <div className="flex items-center gap-3 py-2.5">
      <Checkbox id={`${id}-${part}`} checked={choice[part]} onCheckedChange={toggle(part)} />
      <label
        htmlFor={`${id}-${part}`}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-3',
          !choice[part] && 'text-mute line-through decoration-line-strong',
        )}
      >
        <span className={cn('min-w-0 truncate', strong && 'font-bold')}>{label}</span>
        {value && (
          <span
            className={cn('shrink-0 tabular', strong ? 'text-lg font-extrabold' : 'font-semibold')}
          >
            {value}
          </span>
        )}
      </label>
    </div>
  )

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div className="relative rounded-t-card border border-b-0 border-line bg-paper px-4 pt-3 pb-6 text-ink [--tooth:0.625rem] [mask:linear-gradient(#000_0_0)_top/100%_calc(100%-var(--tooth))_no-repeat,conic-gradient(from_135deg_at_top,#000_90deg,#0000_0)_bottom/calc(2*var(--tooth))_var(--tooth)_repeat-x]">
        {scan.merchant &&
          row(
            'name',
            <span className="font-display text-2xl leading-tight italic">{scan.merchant}</span>,
          )}
        {scan.date &&
          row(
            'date',
            t('expenses.scan.date'),
            formatDate(scan.date, { timeZone, style: 'medium' }),
          )}
        {scan.items.length > 0 && (
          <div className="border-t border-dashed border-line-strong">
            {row('items', t('expenses.scan.items', { count: scan.items.length }))}
            <ul
              className={cn(
                'mb-2 ml-9 flex flex-col gap-1 text-sm',
                !choice.items && 'text-mute opacity-60',
              )}
            >
              {scan.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {item.quantity > 1
                      ? t('expenses.scan.quantity', {
                          count: item.quantity,
                          name: item.description,
                        })
                      : item.description}
                  </span>
                  <Money cents={item.amountCents} currency={currency} tone="neutral" />
                </li>
              ))}
              {(
                [
                  ['tax', scan.taxCents],
                  ['tip', scan.tipCents],
                  ['discount', scan.discountCents],
                ] as const
              ).map(
                ([key, cents]) =>
                  cents !== null && (
                    <li key={key} className="flex justify-between gap-3 text-mute">
                      <span>{t(`expenses.itemized.${key}`)}</span>
                      <Money
                        cents={key === 'discount' ? -cents : cents}
                        currency={currency}
                        tone="neutral"
                      />
                    </li>
                  ),
              )}
            </ul>
            {choice.items && (
              <p className="mb-2 ml-9 text-xs text-mute">{t('expenses.scan.itemsHint')}</p>
            )}
          </div>
        )}
        {scan.totalCents !== null && (
          <div className="border-t border-dashed border-line-strong">
            {row(
              'total',
              t('expenses.scan.total'),
              <Money cents={scan.totalCents} currency={currency} tone="neutral" />,
              true,
            )}
            {off && (
              <p className="ml-9 text-xs font-medium text-saffron-ink">
                {t('expenses.scan.itemsOff', {
                  items: formatMoney(itemsTotal, currency),
                  total: formatMoney(scan.totalCents, currency),
                })}
              </p>
            )}
          </div>
        )}
        {scan.currency && scan.currency !== formCurrency && (
          <p className="mt-1 flex justify-between border-t border-dashed border-line-strong pt-2.5 text-sm">
            <span className="text-mute">{t('expenses.scan.currency')}</span>
            <span className="font-semibold">{scan.currency}</span>
          </p>
        )}
      </div>
      {canAttach && (
        <Checkbox
          label={t('expenses.scan.attach')}
          checked={attach}
          onCheckedChange={(on) => onAttach(on === true)}
        />
      )}
    </div>
  )
}
