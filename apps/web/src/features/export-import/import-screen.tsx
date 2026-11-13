import {
  importExpenses,
  moneyQueries,
  transferKeys,
  transferQueries,
  type FxHistory,
  type ImportFailure,
  type MoneyGroup,
} from '@potluck/api'
import {
  MAX_IMPORT_ROWS,
  SKIP_PERSON,
  alreadyThere,
  dayKey,
  failedLine,
  guessMapping,
  nearestRate,
  paymentProblem,
  peopleInScope,
  planImport,
  rateIsOutlier,
  rateOnDay,
  trimRate,
  type DateFormat,
  type ExistingRow,
  type ImportPlan,
  type ImportRow,
  type MissingRate,
  type SkipReason,
  type SourceFile,
  type SourceIssue,
} from '@potluck/core'
import { formatDate, formatMoney, formatRate, formatRelative, t } from '@potluck/i18n'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  LoadingDots,
  Select,
  Skeleton,
  buttonClassName,
  cn,
  toast,
} from '@potluck/ui'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, Check, FileSpreadsheet, Upload } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { namesOf } from '@/features/expenses/expense-math'
import { Money } from '@/features/expenses/money'
import {
  invalidateMoney,
  moneyErrorMessage,
  useMoneyGroup,
  useNameOf,
  usePeople,
  useTimeZone,
} from '@/features/expenses/money-data'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { avatarSrc } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { importLabelSets } from './labels'
import { FarRate, RateCard } from './rate-card'

type RateCheck = Parameters<typeof RateCard>[0]['check']
import { fingerprint, readFile } from './read-file'

/** How many rows of the file the preview lists before "and N more". */
const PREVIEW_ROWS = 6

/** Server codes that mean someone in the row has left the group. */
const LEFT_CODES = new Set([
  'split_member_not_in_group',
  'payer_not_in_group',
  'member_not_in_group',
])

function issueText(issue: SourceIssue): string {
  const message = t(`transfer.import.issues.${issue.code}` as 'transfer.import.issues.bad_date', {
    detail: issue.detail ?? '',
  })
  return issue.line > 0 ? t('transfer.import.rowFailed', { line: issue.line, message }) : message
}

/** The row a server error points at (`import_row:<n>`). */
function rowOf(plan: ImportPlan, hint: unknown): ImportRow | undefined {
  const match = typeof hint === 'string' ? /^import_row:(\d+)$/.exec(hint) : null
  return match ? plan.rows[Number(match[1]) - 1] : undefined
}

/** What to say when the server refuses the import. */
function failureText(error: unknown, plan: ImportPlan): string {
  const e = (error ?? {}) as Partial<ImportFailure>
  const line = failedLine(plan, e.hint)
  let text: string
  if (e.code === '57014') text = t('transfer.import.errors.timeout')
  else if (line && e.message === 'fx_rate_out_of_range')
    text = t('transfer.import.errors.rate', { line })
  else if (line && e.message === 'invalid_currency')
    text = t('transfer.import.errors.currency', { line, currency: rowOf(plan, e.hint)!.currency })
  else if (line && e.message && LEFT_CODES.has(e.message))
    text = t('transfer.import.errors.left', { line })
  else {
    const message = moneyErrorMessage(error)
    text = line ? t('transfer.import.rowFailed', { line, message }) : message
  }
  const before = (e.imported?.expenses ?? 0) + (e.imported?.payments ?? 0)
  return before > 0 ? `${text} ${t('transfer.import.errors.partly', { count: before })}` : text
}

function Step({
  title,
  help,
  headingRef,
  children,
}: {
  title: string
  help?: ReactNode
  headingRef?: RefObject<HTMLHeadingElement | null>
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3
          id={id}
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="text-sm font-bold text-mute outline-none"
        >
          {title}
        </h3>
        {help}
      </div>
      {children}
    </section>
  )
}

/** The file picker: a tap target on phones, a drop zone on desktop. */
function FilePicker({ onFile, busy }: { onFile: (file: File) => void; busy: boolean }) {
  const [over, setOver] = useState(false)
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files[0]
    if (file) onFile(file)
  }
  return (
    <Card
      tone="ghost"
      padding="roomy"
      className={cn(
        'grid justify-items-center gap-3 text-center transition-colors',
        over && 'border-tomato bg-tomato-soft/40',
      )}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-full bg-saffron-soft text-saffron-ink"
      >
        <FileSpreadsheet className="size-6" />
      </span>
      {/* The label is the button, so the file input is the one control a screen reader meets. */}
      <label
        className={cn(
          buttonClassName({ variant: 'ink' }),
          'cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-tomato has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-paper',
          busy && 'pointer-events-none',
        )}
        aria-busy={busy || undefined}
      >
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFile(file)
            event.target.value = ''
          }}
        />
        {busy ? <LoadingDots /> : <Upload aria-hidden className="-ml-1 size-4" />}
        {t('transfer.import.pick')}
      </label>
      <p className="hidden text-sm text-mute sm:block">{t('transfer.import.pickHint')}</p>
      <ul className="grid max-w-md gap-1 text-left text-sm text-mute">
        <li>{t('transfer.import.fromSplitwise')}</li>
        <li>{t('transfer.import.fromPotluck')}</li>
      </ul>
    </Card>
  )
}

function IssueList({ issues }: { issues: readonly string[] }) {
  if (issues.length === 0) return null
  const shown = issues.slice(0, 12)
  return (
    <Card tone="sunken" padding="default" className="grid gap-2" role="alert">
      <p className="flex items-center gap-2 font-semibold text-tomato-ink">
        <AlertTriangle aria-hidden className="size-4" />
        {t('transfer.import.fixFirst')}
      </p>
      <ul className="grid gap-1 text-sm">
        {shown.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
      {issues.length > shown.length && (
        <p className="text-sm text-mute">
          {t('transfer.import.more', { count: issues.length - shown.length })}
        </p>
      )}
    </Card>
  )
}

/** "You paid", "Ava paid", "Paid by you and Ben", "Ben paid you", "Refund to Cleo". */
function rowLine(row: ImportRow, me: string, nameOf: ReturnType<typeof useNameOf>): string {
  if (row.kind === 'payment') {
    if (row.from_user === me) return t('transfer.import.rowPaymentYou', { to: nameOf(row.to_user) })
    if (row.to_user === me)
      return t('transfer.import.rowPaymentToYou', { from: nameOf(row.from_user) })
    return t('transfer.import.rowPayment', { from: nameOf(row.from_user), to: nameOf(row.to_user) })
  }
  const ids = row.payers.map((p) => p.user_id)
  if (row.is_refund) {
    return t('transfer.import.rowRefund', { names: namesOf(ids, me, nameOf, { start: false }) })
  }
  if (ids.length === 1 && ids[0] === me) return t('transfer.import.rowPaidYou')
  if (ids.length === 1) return t('transfer.import.rowPaid', { names: nameOf(ids[0]!) })
  return t('transfer.import.rowPaidMany', { names: namesOf(ids, me, nameOf, { start: false }) })
}

/** Everyone's balance after the import, in the group currency, drawn like the balances tab. */
function BalancesAfter({ plan, group }: { plan: ImportPlan; group: MoneyGroup }) {
  const nameOf = useNameOf()
  const people = usePeople()
  const balances = useQuery(moneyQueries.balances(supabase, group.id))
  const now = new Map((balances.data ?? []).map((b) => [b.user_id, b.net_cents]))
  const ids = [...new Set([...group.members.map((m) => m.id), ...Object.keys(plan.balances)])]
  const rows = ids
    .map((id) => ({
      id,
      now: now.get(id) ?? 0,
      after: (now.get(id) ?? 0) + (plan.balances[id] ?? 0),
    }))
    .sort((a, b) => b.after - a.after)
  const scale = Math.max(1, ...rows.map((r) => Math.abs(r.after)))
  return (
    <Card padding="none" className="overflow-hidden">
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const person = people.get(r.id)
          return (
            <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center gap-3">
                <Avatar
                  name={person?.display_name ?? '?'}
                  seed={r.id}
                  src={avatarSrc(person?.avatar_path)}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{nameOf(r.id)}</span>
                  <span className="block text-xs text-mute">
                    {t('transfer.import.now', { amount: formatMoney(r.now, group.currency) })}
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="text-xs text-mute">
                    {r.after > 0
                      ? t('balances.isOwedShort')
                      : r.after < 0
                        ? t('balances.owesShort')
                        : t('balances.settledShort')}
                  </span>
                  {r.after !== 0 && (
                    <Money
                      cents={Math.abs(r.after)}
                      currency={group.currency}
                      tone={r.after > 0 ? 'owed' : 'owe'}
                      className="font-bold"
                    />
                  )}
                </span>
              </div>
              <div aria-hidden className="relative h-1.5 rounded-pill bg-sunken">
                <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                <span
                  className={cn(
                    'absolute inset-y-0 rounded-pill',
                    r.after >= 0 ? 'left-1/2 bg-saffron' : 'right-1/2 bg-tomato',
                  )}
                  style={{ width: `${(Math.abs(r.after) / scale) * 50}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * Stored rates for every other currency in the file, the same ones the server would take. The
 * lookup answers undefined while a currency is still loading.
 */
function useRates(source: SourceFile | null, groupCurrency: string) {
  const needed = useMemo(() => {
    const currencies = new Set<string>()
    for (const e of source?.entries ?? []) {
      if (e.currency !== groupCurrency) currencies.add(e.currency)
    }
    return [...currencies].sort()
  }, [source, groupCurrency])
  const loaded = useQueries({
    queries: needed.map((currency) => transferQueries.fxHistory(supabase, currency, groupCurrency)),
    combine: (results) => results.map((r) => r.data),
  })
  return useMemo(() => {
    const byCurrency = new Map(needed.map((currency, i) => [currency, loaded[i]]))
    const historyOf = (currency: string): FxHistory | undefined => byCurrency.get(currency)
    const rateOn = (currency: string, day: string): string | null | undefined => {
      const history = historyOf(currency)
      return history ? rateOnDay(history, day) : undefined
    }
    return { rateOn, historyOf }
  }, [needed, loaded])
}

/**
 * A typed rate against Potluck's own, as `import_expenses` will hold it: each day it is used for
 * against the stored rate nearest that day. Undefined while the rates load.
 */
function rateCheck(missing: MissingRate, history: FxHistory | undefined): RateCheck | undefined {
  if (!history) return undefined
  if (!history.known) return { unsupported: true }
  const references = missing.days.map((day) => nearestRate(history, day))
  const far = missing.typed
    ? references.findIndex((reference) => rateIsOutlier(missing.typed!, reference))
    : -1
  return {
    unsupported: false,
    outlier: far >= 0,
    reference: references[Math.max(far, 0)] ?? null,
  }
}

/** A currency whose rates from a Potluck file `import_expenses` holds as far off. */
interface FarFileRate {
  currency: string
  /** The first such rate, and the stored rate nearest its day (null when there is none). */
  rate: string
  reference: string | null
}

/**
 * The file's rates held as `import_expenses` will hold them: each against the stored rate nearest
 * its day. Null while a currency's rates load.
 */
function farFileRates(
  rates: ImportPlan['fileRates']['rates'],
  historyOf: (currency: string) => FxHistory | undefined,
): FarFileRate[] | null {
  const far = new Map<string, FarFileRate>()
  for (const r of rates) {
    const history = historyOf(r.currency)
    if (!history) return null
    if (!history.known || far.has(r.currency)) continue
    const reference = nearestRate(history, r.day)
    if (rateIsOutlier(r.rate, reference)) {
      far.set(r.currency, { currency: r.currency, rate: r.rate, reference })
    }
  }
  return [...far.values()]
}

export function ImportScreen({ groupId }: { groupId: string }) {
  const group = useMoneyGroup(groupId)
  if (group.isPending || !group.data) {
    return (
      <div className="grid gap-4" aria-hidden>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48" />
      </div>
    )
  }
  return <ImportBody group={group.data} />
}

function ImportBody({ group }: { group: MoneyGroup }) {
  const me = useUserId()
  const nameOf = useNameOf()
  const people = usePeople()
  const timeZone = useTimeZone()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const expenses = useQuery(moneyQueries.expenses(supabase, group.id))
  const settlements = useQuery(moneyQueries.settlements(supabase, group.id))
  const pastImports = useQuery(transferQueries.pastImports(supabase, group.id))
  const [text, setText] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileId, setFileId] = useState<string | undefined>()
  const [reading, setReading] = useState(false)
  const [source, setSource] = useState<SourceFile | null>(null)
  const [mapping, setMapping] = useState<(string | null)[]>([])
  const [fromGroup, setFromGroup] = useState<string | null>(null)
  const [typedRates, setTypedRates] = useState<Record<string, string>>({})
  const [skipCurrencies, setSkipCurrencies] = useState<ReadonlySet<string>>(new Set())
  const [leaveOutDuplicates, setLeaveOutDuplicates] = useState(false)
  const [confirmedRates, setConfirmedRates] = useState<ReadonlySet<string>>(new Set())
  const [confirmedFileRates, setConfirmedFileRates] = useState<ReadonlySet<string>>(new Set())
  const [partlyImported, setPartlyImported] = useState(false)
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const fileHeading = useRef<HTMLParagraphElement>(null)
  const [focusAfterRead, setFocusAfterRead] = useState(false)

  // People who were in the group and have left: they can be matched, but rows with them wait.
  const former = useMemo(() => {
    const members = new Set(group.members.map((m) => m.id))
    const ids = new Set<string>()
    for (const e of expenses.data ?? []) {
      for (const p of e.expense_payers) ids.add(p.user_id)
      for (const s of e.expense_splits) ids.add(s.user_id)
    }
    for (const s of settlements.data ?? []) ids.add(s.from_user).add(s.to_user)
    return [...ids]
      .filter((id) => !members.has(id))
      .map((id) => ({ id, name: people.get(id)?.display_name ?? t('transfer.csv.someoneWhoLeft') }))
  }, [group.members, expenses.data, settlements.data, people])

  async function read(content: string, options: { dateFormat?: DateFormat } = {}) {
    const read = await readFile(content, importLabelSets(), options)
    setSource(read)
    return read
  }

  async function choose(file: File) {
    setReading(true)
    setFailure(null)
    setFileName(file.name)
    try {
      const content = await file.text()
      setText(content)
      const [read_, id] = await Promise.all([read(content), fingerprint(content)])
      setFileId(id)
      setMapping(
        guessMapping(read_.people, [
          ...group.members.map((m) => ({ id: m.id, name: m.display_name })),
          ...former,
        ]),
      )
      setFromGroup(read_.groups.includes(group.name) ? group.name : (read_.groups[0] ?? null))
      setTypedRates({})
      setSkipCurrencies(new Set())
      setConfirmedFileRates(new Set())
      setLeaveOutDuplicates(false)
      setFocusAfterRead(true)
    } finally {
      setReading(false)
    }
  }

  const { rateOn, historyOf } = useRates(source, group.currency)
  const existing = useMemo<ExistingRow[]>(
    () => [
      ...(expenses.data ?? []).map((e) => ({
        kind: 'expense' as const,
        day: e.spent_at,
        amountCents: e.amount_cents,
        currency: e.currency,
        description: e.description,
      })),
      ...(settlements.data ?? []).map((s) => ({
        kind: 'payment' as const,
        day: dayKey(s.settled_at, timeZone),
        amountCents: s.amount_cents,
        currency: s.currency,
        fromUser: s.from_user,
        toUser: s.to_user,
      })),
    ],
    [expenses.data, settlements.data, timeZone],
  )

  const options = useMemo(
    () => ({
      mapping,
      group: fromGroup,
      untitled: t('transfer.import.untitled'),
      groupCurrency: group.currency,
      rateOn,
      typedRates,
      skipCurrencies,
      confirmedRates,
      confirmedFileRates,
    }),
    [
      mapping,
      fromGroup,
      group.currency,
      rateOn,
      typedRates,
      skipCurrencies,
      confirmedRates,
      confirmedFileRates,
    ],
  )
  const basePlan = useMemo(() => (source ? planImport(source, options) : null), [source, options])
  const duplicates = useMemo(
    () => (basePlan ? alreadyThere(basePlan, existing) : []),
    [basePlan, existing],
  )
  const plan = useMemo(
    () =>
      source && leaveOutDuplicates && duplicates.length > 0
        ? planImport(source, { ...options, skipLines: new Set(duplicates) })
        : basePlan,
    [source, options, leaveOutDuplicates, duplicates, basePlan],
  )

  useEffect(() => {
    if (!focusAfterRead || !source) return
    ;(previewHeading.current ?? fileHeading.current)?.focus()
    setFocusAfterRead(false)
  }, [focusAfterRead, source, plan])

  const formerIds = new Set(former.map((f) => f.id))
  const inScope = source ? peopleInScope(source, fromGroup) : []
  const leftIssues = inScope
    .filter((i) => mapping[i] && formerIds.has(mapping[i]!))
    .map((i) => t('transfer.import.left', { name: source!.people[i]!, group: group.name }))
  // Payments go through check_payment: a plain member brings in only their own.
  const myRole = group.members.find((m) => m.id === me)?.role
  const memberIds = group.members.map((m) => m.id)
  const notMine = (plan?.rows ?? []).filter(
    (row) =>
      row.kind === 'payment' &&
      paymentProblem({
        viewerId: me,
        viewerRole: myRole,
        fromUser: row.from_user,
        toUser: row.to_user,
        amountCents: row.amount_cents,
        memberIds,
      }) === 'not_a_party',
  ).length
  const issues = [
    ...leftIssues,
    ...(notMine > 0 ? [t('transfer.import.notAParty', { count: notMine })] : []),
    ...(plan?.issues ?? []).map(issueText),
  ]
  const total = plan?.rows.length ?? 0
  const checks = new Map(
    (plan?.missingRates ?? []).map((m) => [m.currency, rateCheck(m, historyOf(m.currency))]),
  )
  const fileFar = plan ? farFileRates(plan.fileRates.rates, historyOf) : []
  const ratesOpen =
    fileFar === null ||
    fileFar.some((f) => !confirmedFileRates.has(f.currency)) ||
    (plan?.missingRates ?? []).some((m) => {
      if (m.skipped) return false
      const check = checks.get(m.currency)
      if (!check || check.unsupported || !m.typed) return true
      return check.outlier && !confirmedRates.has(m.currency)
    })
  const blocked = !plan || issues.length > 0 || ratesOpen || plan.ratesPending || total === 0
  const leftOut = (['person', 'rate', 'duplicate'] as const).some((r) =>
    plan?.skipped.some((s) => s.reason === r),
  )
  const earlier = fileId ? (pastImports.data ?? []).filter((p) => p.fingerprint === fileId) : []
  const sameFile = earlier[0]
  // An import that stopped part way (or one before this screen) brought in only some rows.
  const partOfFile =
    partlyImported ||
    earlier.reduce((sum, p) => sum + p.expenses + p.payments, 0) < (basePlan?.rows.length ?? 0)
  const parts = Math.ceil(total / MAX_IMPORT_ROWS)

  const submit = useMutation({
    mutationFn: () =>
      importExpenses(supabase, group.id, plan!.rows, source!.format, {
        fingerprint: fileId,
        onProgress: (sent, all) => setProgress({ sent, total: all }),
      }),
    onSuccess: async (result) => {
      invalidateMoney(queryClient, group.id)
      void queryClient.invalidateQueries({ queryKey: transferKeys.imports(group.id) })
      toast.success(
        t('transfer.import.done', { count: result.expenses + result.payments, group: group.name }),
      )
      await navigate({ to: '/groups/$groupId', params: { groupId: group.id } })
    },
    onError: (error) => {
      setFailure(failureText(error, plan!))
      if (LEFT_CODES.has((error as { message?: string }).message ?? '')) {
        invalidateMoney(queryClient, group.id)
      }
      const imported = (error as Partial<ImportFailure>).imported
      if ((imported?.expenses ?? 0) + (imported?.payments ?? 0) > 0) {
        invalidateMoney(queryClient, group.id)
        setPartlyImported(true)
        setLeaveOutDuplicates(true)
      }
    },
    onSettled: () => setProgress(null),
  })

  const options_ = [
    ...group.members.map((m) => ({ value: m.id, label: m.display_name })),
    ...former.map((f) => ({
      value: f.id,
      label: t('transfer.import.leftOption', { name: f.name }),
    })),
    { value: SKIP_PERSON, label: t('transfer.import.skipPerson') },
  ]

  const skippedBy = (reason: SkipReason) =>
    plan?.skipped.filter((s) => s.reason === reason).length ?? 0

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Link
          to="/groups/$groupId/settings"
          params={{ groupId: group.id }}
          className="inline-flex items-center gap-1 justify-self-start text-sm font-semibold text-mute hover:text-ink"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('groups.tabs.settings')}
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-3xl">{t('transfer.import.title')}</h2>
          <Help topic="importExpenses" />
        </div>
        <p className="max-w-prose text-mute">{t('transfer.import.intro')}</p>
      </div>

      {group.archived_at ? (
        <p className="rounded-card bg-sunken p-4 text-sm text-mute">
          {t('transfer.import.archived')}
        </p>
      ) : !source || reading || !text ? (
        <FilePicker onFile={choose} busy={reading} />
      ) : (
        <>
          <Card padding="default" className="flex flex-wrap items-center gap-3">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-full bg-saffron-soft text-saffron-ink"
            >
              <FileSpreadsheet className="size-5" />
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <p ref={fileHeading} tabIndex={-1} className="truncate font-semibold outline-none">
                {fileName}
              </p>
              <p className="text-sm text-mute">
                {t(`transfer.import.format.${source.format}`)}
                {source.entries.length > 0 &&
                  `, ${t('transfer.import.fileSummary', {
                    count: source.entries.length,
                    people: source.people.join(', '),
                  })}`}
              </p>
              {source.dateFormat !== 'iso' && (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-mute">
                  {t(`transfer.import.dates.${source.dateFormat}`)}
                  {(source.dateAmbiguous || source.issues.some((i) => i.code === 'bad_date')) && (
                    <button
                      type="button"
                      className="font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4"
                      onClick={() =>
                        void read(text, { dateFormat: source.dateFormat === 'mdy' ? 'dmy' : 'mdy' })
                      }
                    >
                      {source.dateFormat === 'mdy'
                        ? t('transfer.import.dates.toDmy')
                        : t('transfer.import.dates.toMdy')}
                    </button>
                  )}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={submit.isPending}
              onClick={() => {
                setSource(null)
                setText(null)
                setFailure(null)
              }}
            >
              {t('transfer.import.another')}
            </Button>
          </Card>

          {sameFile && (
            <p className="flex items-start gap-2 rounded-card bg-saffron-soft p-4 text-sm text-saffron-ink">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t(
                partOfFile
                  ? 'transfer.import.duplicates.partSameFile'
                  : 'transfer.import.duplicates.sameFile',
                {
                  group: group.name,
                  when:
                    Date.now() - new Date(sameFile.at).getTime() < 60_000
                      ? t('transfer.import.justNow')
                      : formatRelative(sameFile.at, { timeZone }),
                },
              )}
            </p>
          )}

          {source.groups.length > 1 && (
            <Field label={t('transfer.import.sourceGroup')}>
              <Select
                value={fromGroup ?? ''}
                onValueChange={setFromGroup}
                options={source.groups.map((g) => ({ value: g, label: g }))}
              />
            </Field>
          )}

          {inScope.length > 0 && (
            <Step title={t('transfer.import.who')}>
              <p className="text-sm text-mute">
                {t('transfer.import.whoHint', { group: group.name })}
              </p>
              <Card padding="roomy" className="grid gap-4 sm:grid-cols-2">
                {inScope.map((i) => {
                  const name = source.people[i]!
                  const left = !!mapping[i] && formerIds.has(mapping[i]!)
                  return (
                    <Field
                      key={`${name}-${i}`}
                      label={name}
                      error={
                        left ? t('transfer.import.left', { name, group: group.name }) : undefined
                      }
                    >
                      <Select
                        value={mapping[i] ?? ''}
                        onValueChange={(id) =>
                          setMapping((m) => m.map((value, j) => (j === i ? id : value)))
                        }
                        placeholder={t('transfer.import.notMatched')}
                        options={options_}
                      />
                    </Field>
                  )
                })}
              </Card>
            </Step>
          )}

          <IssueList issues={issues.filter((text) => !leftIssues.includes(text))} />

          {plan && (plan.missingRates.length > 0 || plan.fileRates.rows > 0) && (
            <Step title={t('transfer.import.rates.title')}>
              {plan.missingRates.map((m) => (
                <RateCard
                  key={m.currency}
                  missing={m}
                  groupCurrency={group.currency}
                  check={checks.get(m.currency)}
                  confirmed={confirmedRates.has(m.currency)}
                  onApply={(rate) =>
                    setTypedRates((r) => {
                      const next = { ...r }
                      if (rate) next[m.currency] = rate
                      else delete next[m.currency]
                      return next
                    })
                  }
                  onSkip={(skip) =>
                    setSkipCurrencies((set) => {
                      const next = new Set(set)
                      if (skip) next.add(m.currency)
                      else next.delete(m.currency)
                      return next
                    })
                  }
                  onConfirm={(yes) =>
                    setConfirmedRates((set) => {
                      const next = new Set(set)
                      if (yes) next.add(m.currency)
                      else next.delete(m.currency)
                      return next
                    })
                  }
                />
              ))}
              {plan.fileRates.rows > 0 && (
                <p className="text-sm text-mute">
                  {t('transfer.import.rates.file', { count: plan.fileRates.rows })}
                  {plan.fileRates.differ > 0 &&
                    ` ${t('transfer.import.rates.differ', { count: plan.fileRates.differ })}`}
                </p>
              )}
              {fileFar?.map((f) => (
                <FarRate
                  key={f.currency}
                  text={
                    f.reference
                      ? t('transfer.import.rates.fileFar', {
                          currency: f.currency,
                          rate: formatRate(trimRate(f.rate)),
                          reference: formatRate(trimRate(f.reference)),
                          group: group.currency,
                        })
                      : t('transfer.import.rates.fileNoReference', {
                          currency: f.currency,
                          group: group.currency,
                        })
                  }
                  confirmed={confirmedFileRates.has(f.currency)}
                  onConfirm={(yes) =>
                    setConfirmedFileRates((set) => {
                      const next = new Set(set)
                      if (yes) next.add(f.currency)
                      else next.delete(f.currency)
                      return next
                    })
                  }
                />
              ))}
            </Step>
          )}

          {duplicates.length > 0 && (
            <Card padding="default" className="grid gap-3 bg-saffron-soft text-saffron-ink">
              <p className="flex items-start gap-2 text-sm">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                {partlyImported
                  ? t('transfer.import.duplicates.fromThisFile', {
                      count: duplicates.length,
                      group: group.name,
                    })
                  : t('transfer.import.duplicates.rows', {
                      count: duplicates.length,
                      group: group.name,
                    })}
              </p>
              <Checkbox
                label={t('transfer.import.duplicates.leaveOut')}
                checked={leaveOutDuplicates}
                onCheckedChange={(checked) => setLeaveOutDuplicates(checked === true)}
              />
            </Card>
          )}

          {plan && plan.rows.length > 0 && (
            <Step title={t('transfer.import.preview')} headingRef={previewHeading}>
              <div className="flex flex-wrap gap-2">
                {plan.counts.expenses > 0 && (
                  <Badge tone="saffron">
                    {t('transfer.import.expenses', { count: plan.counts.expenses })}
                  </Badge>
                )}
                {plan.counts.refunds > 0 && (
                  <Badge tone="plum">
                    {t('transfer.import.refunds', { count: plan.counts.refunds })}
                  </Badge>
                )}
                {plan.counts.payments > 0 && (
                  <Badge tone="olive">
                    {t('transfer.import.payments', { count: plan.counts.payments })}
                  </Badge>
                )}
              </div>
              {(
                [
                  ['no_effect', 'transfer.import.skipped'],
                  ['person', 'transfer.import.skippedPerson'],
                  ['rate', 'transfer.import.skippedRate'],
                  ['duplicate', 'transfer.import.skippedDuplicate'],
                ] as const
              ).map(([reason, key]) =>
                skippedBy(reason) > 0 ? (
                  <p key={reason} className="text-sm text-mute">
                    {t(key, { count: skippedBy(reason) })}
                  </p>
                ) : null,
              )}
              {plan.totals !== 'none' && (
                <p
                  className={cn(
                    'flex items-center gap-2 text-sm font-semibold',
                    plan.totals === 'match' && !leftOut ? 'text-olive-ink' : 'text-saffron-ink',
                  )}
                >
                  {plan.totals === 'match' && !leftOut ? (
                    <Check aria-hidden className="size-4" />
                  ) : (
                    <AlertTriangle aria-hidden className="size-4" />
                  )}
                  {plan.totals === 'match'
                    ? leftOut
                      ? t('transfer.import.totalsLeftOut')
                      : t('transfer.import.totalsMatch')
                    : t('transfer.import.totalsMismatch')}
                </p>
              )}

              <h4 className="mt-2 text-sm font-bold text-mute">{t('transfer.import.balances')}</h4>
              {plan.ratesPending ? (
                <p className="flex items-center gap-2 text-sm text-mute">
                  <LoadingDots /> {t('transfer.import.rates.pending')}
                </p>
              ) : plan.missingRates.some((m) => !m.typed && !m.skipped) ? (
                <p className="text-sm text-mute">{t('transfer.import.rates.waiting')}</p>
              ) : (
                <BalancesAfter plan={plan} group={group} />
              )}

              <h4 className="mt-2 text-sm font-bold text-mute">{t('transfer.import.rows')}</h4>
              <Card padding="none" className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {plan.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                    <li key={plan.lines[i]} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-20 shrink-0 text-xs text-mute tabular-nums">
                        {formatDate(row.kind === 'payment' ? row.paid_on : row.spent_at, {
                          timeZone: 'UTC',
                        })}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {row.kind === 'payment'
                            ? t('transfer.csv.kinds.payment')
                            : row.description}
                        </span>
                        <span className="block truncate text-sm text-mute">
                          {rowLine(row, me, nameOf)}
                        </span>
                      </span>
                      <Money
                        cents={row.amount_cents}
                        currency={row.currency}
                        tone="neutral"
                        className="font-semibold"
                      />
                    </li>
                  ))}
                </ul>
                {plan.rows.length > PREVIEW_ROWS && (
                  <p className="border-t border-line px-4 py-3 text-sm text-mute">
                    {t('transfer.import.more', { count: plan.rows.length - PREVIEW_ROWS })}
                  </p>
                )}
              </Card>
              {parts > 1 && (
                <p className="text-sm text-mute">
                  {t('transfer.import.parts', { count: total, parts })}
                </p>
              )}
            </Step>
          )}

          {failure && (
            <p role="alert" className="rounded-card bg-tomato-soft p-4 text-sm text-tomato-ink">
              {failure}
            </p>
          )}

          <Button
            size="lg"
            className="justify-self-stretch sm:justify-self-start"
            disabled={blocked || submit.isPending}
            loading={submit.isPending && !progress}
            onClick={() => {
              setFailure(null)
              submit.mutate()
            }}
          >
            {submit.isPending
              ? progress
                ? t('transfer.import.progress', { sent: progress.sent, total: progress.total })
                : t('transfer.import.importing')
              : blocked
                ? t('transfer.import.submitBlocked')
                : t('transfer.import.submit', { count: total })}
          </Button>
        </>
      )}
    </div>
  )
}
