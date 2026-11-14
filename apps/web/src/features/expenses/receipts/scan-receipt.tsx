import { parseReceipt, receiptDateOrder, receiptItemsMatch, type ReceiptScan } from '@potluck/core'
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
import { AlertTriangle, ScanLine } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Help } from '@/features/help/help'
import { todayIn } from '../format'
import { CompactMoneyInput } from '../form/compact-inputs'
import type { SplitDraft } from '../form/split-state'
import { draftFromFile, type AttachmentDraft } from './attachments-state'
import { prepareImage } from './image'
import { ReaderUnavailableError, readReceiptText, type ReadStage } from './ocr'
import { ZoomableImage } from './zoomable-image'
import {
  bestScan,
  defaultChoice,
  fillFromScan,
  readingsEnough,
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
  | { phase: 'reading'; photo: File; original: File; stage: ReadStage; progress: number }
  | {
      phase: 'review'
      photo: File
      original: File
      scan: ReceiptScan
      choice: ScanChoice
      attach: boolean
    }
  | { phase: 'empty'; photo: File; original: File }
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
  // The photo as picked, shown while reading and beside the review.
  const original = 'original' in state ? state.original : null
  const url = useMemo(() => (original ? URL.createObjectURL(original) : null), [original])
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
    // The reader works from the original photo; the shrunk JPEG is only what gets uploaded.
    setState({ phase: 'reading', photo: picked, original: picked, stage: 'loading', progress: 0 })
    const upload = prepareImage(picked)
    const parse = (text: string) =>
      parseReceipt(text, {
        currency,
        dateOrder: receiptDateOrder(currency, intlLocale()),
        today: todayIn(timeZone),
      })
    try {
      const texts = await readReceiptText(picked, {
        signal: controller.signal,
        onProgress: ({ stage, progress }) =>
          setState((s) => (s.phase === 'reading' ? { ...s, stage, progress } : s)),
        // Only a reading that is still far off tries the plain colour photo too.
        enough: (texts) => readingsEnough(texts.map(parse)),
      })
      const scan = bestScan((texts.length > 0 ? texts : ['']).map(parse))
      const photo = await upload
      setState(
        scanFoundSomething(scan)
          ? {
              phase: 'review',
              photo,
              original: picked,
              scan,
              choice: defaultChoice(scan, description),
              attach: canAttach,
            }
          : { phase: 'empty', photo, original: picked },
      )
    } catch (error) {
      if (controller.signal.aborted) return
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
          size={state.phase === 'review' ? 'lg' : 'md'}
          footer={footer}
        >
          {state.phase === 'reading' && url && (
            <Reading url={url} stage={state.stage} progress={state.progress} />
          )}
          {state.phase === 'review' && url && (
            <Review
              url={url}
              scan={state.scan}
              choice={state.choice}
              formCurrency={currency}
              timeZone={timeZone}
              onScan={(scan) => setState({ ...state, scan })}
              onChoice={(choice) => setState({ ...state, choice })}
              attach={state.attach}
              canAttach={canAttach}
              onAttach={(attach) => setState({ ...state, attach })}
            />
          )}
          {state.phase === 'empty' && (
            <Message url={url ?? undefined}>{t('expenses.scan.nothing')}</Message>
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
  const label =
    stage === 'loading'
      ? t('expenses.scan.loading')
      : stage === 'closer'
        ? t('expenses.scan.closer')
        : t('expenses.scan.reading')
  const reading = stage !== 'loading'
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
          value={reading ? progress : 0}
          label={label}
          valueText={t('expenses.scan.percent', { percent: reading ? percent : 0 })}
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
 * What the receipt says, set like a till roll beside the photo: one box per part, so a misread
 * date or a wrong total can be left out, and every price can be corrected against the photo.
 */
function Review({
  url,
  scan,
  choice,
  formCurrency,
  timeZone,
  onScan,
  onChoice,
  attach,
  canAttach,
  onAttach,
}: {
  url: string
  scan: ReceiptScan
  choice: ScanChoice
  formCurrency: string
  timeZone: string
  onScan: (scan: ReceiptScan) => void
  onChoice: (choice: ScanChoice) => void
  attach: boolean
  canAttach: boolean
  onAttach: (attach: boolean) => void
}) {
  const id = useId()
  const locale = intlLocale()
  const currency = scan.currency ?? formCurrency
  const itemsTotal = useMemo(() => scanItemsTotal(scan), [scan])
  const toggle = (key: keyof ScanChoice) => (on: boolean | 'indeterminate') =>
    onChoice({ ...choice, [key]: on === true })
  // A corrected price is checked against the total again straight away. A total that was only
  // the items added up follows them.
  const edit = (patch: Partial<ReceiptScan>) => {
    const next = { ...scan, ...patch }
    if (next.totalDerived && next.subtotalCents === null) next.totalCents = scanItemsTotal(next)
    onScan({ ...next, itemsMatch: receiptItemsMatch(next) })
  }
  const price = (
    label: string,
    cents: number | null,
    onChange: (cents: number) => void,
    className?: string,
  ) => (
    <CompactMoneyInput
      currency={currency}
      locale={locale}
      value={cents}
      onValueChange={(next) => onChange(next ?? 0)}
      aria-label={`${t('expenses.itemized.itemAmount')}, ${label}`}
      className={cn('h-9 w-24 shrink-0 bg-card text-right', className)}
    />
  )

  const row = (part: keyof ScanChoice, label: ReactNode, value?: ReactNode, strong = false) => (
    <div className="flex items-center gap-3 py-2">
      <Checkbox id={`${id}-${part}`} checked={choice[part]} onCheckedChange={toggle(part)} />
      <label
        htmlFor={`${id}-${part}`}
        className={cn(
          'min-w-0 flex-1 cursor-pointer truncate',
          strong && 'font-bold',
          !choice[part] && 'text-mute line-through decoration-line-strong',
        )}
      >
        {label}
      </label>
      {value}
    </div>
  )
  const extras = (
    [
      ['tax', 'taxCents'],
      ['tip', 'tipCents'],
      ['discount', 'discountCents'],
    ] as const
  ).filter(([, key]) => scan[key] !== null)

  return (
    <div className="flex flex-col gap-4 pt-1 md:flex-row md:items-start">
      <ZoomableImage
        src={url}
        alt={t('expenses.scan.photoAlt')}
        className="w-full shrink-0 md:sticky md:top-0 md:w-56"
        frameClassName="h-48 rounded-card border border-line bg-sunken sm:h-64 md:h-[24rem]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="relative rounded-t-card border border-b-0 border-line bg-paper px-4 pt-2 pb-6 text-ink [--tooth:0.625rem] [mask:linear-gradient(#000_0_0)_top/100%_calc(100%-var(--tooth))_no-repeat,conic-gradient(from_135deg_at_top,#000_90deg,#0000_0)_bottom/calc(2*var(--tooth))_var(--tooth)_repeat-x]">
          {scan.merchant &&
            row(
              'name',
              <span className="font-display text-2xl leading-tight italic">{scan.merchant}</span>,
            )}
          {scan.date &&
            row(
              'date',
              t('expenses.scan.date'),
              <span className="shrink-0 tabular font-semibold">
                {formatDate(scan.date, { timeZone, style: 'medium' })}
              </span>,
            )}
          {scan.items.length > 0 && (
            <div className="border-t border-dashed border-line-strong">
              {row('items', t('expenses.scan.items', { count: scan.items.length }))}
              <ul
                className={cn(
                  'mb-2 ml-9 flex flex-col gap-1.5 text-sm',
                  !choice.items && 'text-mute opacity-60',
                )}
              >
                {scan.items.map((item, i) => {
                  const name =
                    item.quantity > 1
                      ? t('expenses.scan.quantity', {
                          count: item.quantity,
                          name: item.description,
                        })
                      : item.description
                  return (
                    <li key={i} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 wrap-anywhere">{name}</span>
                      {price(name, item.amountCents, (cents) =>
                        edit({
                          items: scan.items.map((x, j) =>
                            j === i ? { ...x, amountCents: cents } : x,
                          ),
                        }),
                      )}
                    </li>
                  )
                })}
                {extras.map(([label, key]) => (
                  <li key={key} className="flex items-center justify-between gap-3 text-mute">
                    <span>{t(`expenses.itemized.${label}`)}</span>
                    {price(t(`expenses.itemized.${label}`), scan[key], (cents) =>
                      edit({ [key]: cents }),
                    )}
                  </li>
                ))}
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
                price(
                  t('expenses.scan.total'),
                  scan.totalCents,
                  (cents) => edit({ totalCents: cents, totalDerived: false }),
                  'text-lg font-extrabold',
                ),
                true,
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
        {scan.totalDerived && scan.totalCents !== null && (
          <div
            role="status"
            className="flex gap-2.5 rounded-card bg-saffron-soft px-3 py-2.5 text-sm text-saffron-ink"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p className="font-semibold">{t('expenses.scan.totalDerived')}</p>
          </div>
        )}
        {scan.itemsMatch !== null &&
          scan.itemsMatch !== 'exact' &&
          scan.itemsMatch !== 'unconfirmed' &&
          scan.totalCents !== null && (
            <div
              role="status"
              className="flex gap-2.5 rounded-card bg-saffron-soft px-3 py-2.5 text-sm text-saffron-ink"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p>
                <span className="font-semibold">
                  {t('expenses.scan.itemsOff', {
                    items: formatMoney(itemsTotal, currency),
                    total: formatMoney(scan.totalCents, currency),
                  })}
                </span>{' '}
                {t('expenses.scan.checkPrices')}
              </p>
            </div>
          )}
        {canAttach && (
          <Checkbox
            label={t('expenses.scan.attach')}
            checked={attach}
            onCheckedChange={(on) => onAttach(on === true)}
          />
        )}
      </div>
    </div>
  )
}
