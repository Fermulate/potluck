import { importExpenses, moneyQueries, type MoneyGroup } from '@potluck/api'
import {
  failedLine,
  guessMapping,
  planImport,
  type ImportPlan,
  type ImportRow,
  type SourceFile,
  type SourceIssue,
} from '@potluck/core'
import { formatDate, formatMoney, t } from '@potluck/i18n'
import { Avatar, Badge, Button, Card, Field, Select, Skeleton, cn, toast } from '@potluck/ui'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, Check, FileSpreadsheet, Upload } from 'lucide-react'
import { useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  invalidateMoney,
  moneyErrorMessage,
  useMoneyGroup,
  useNameOf,
  usePeople,
} from '@/features/expenses/money-data'
import { namesOf } from '@/features/expenses/expense-math'
import { Money } from '@/features/expenses/money'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { avatarSrc } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { importLabelSets } from './labels'
import { readFile } from './read-file'

/** How many rows of the file the preview lists before "and N more". */
const PREVIEW_ROWS = 6

function issueText(issue: SourceIssue): string {
  const message = t(`transfer.import.issues.${issue.code}` as 'transfer.import.issues.bad_date', {
    detail: issue.detail ?? '',
  })
  return issue.line > 0 ? t('transfer.import.rowFailed', { line: issue.line, message }) : message
}

function Step({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={id} className="text-sm font-bold text-mute">
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
  const input = useRef<HTMLInputElement>(null)
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
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="sr-only"
        aria-label={t('transfer.import.pick')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ''
        }}
      />
      <Button
        variant="ink"
        leadingIcon={<Upload />}
        loading={busy}
        onClick={() => input.current?.click()}
      >
        {t('transfer.import.pick')}
      </Button>
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

/** "Ava paid", "You and Ben paid", "Ben paid Ava", "Refund to Cleo". */
function rowLine(row: ImportRow, me: string, nameOf: ReturnType<typeof useNameOf>): string {
  if (row.kind === 'payment') {
    return t('transfer.import.rowPayment', {
      from: nameOf(row.from_user),
      to: nameOf(row.to_user, { lower: true }),
    })
  }
  const names = namesOf(
    row.payers.map((p) => p.user_id),
    me,
    nameOf,
  )
  return row.is_refund
    ? t('transfer.import.rowRefund', {
        names: namesOf(
          row.payers.map((p) => p.user_id),
          me,
          nameOf,
          { start: false },
        ),
      })
    : t('transfer.import.rowPaid', { names })
}

/** Balances in the group currency after the import, drawn like the balances tab. */
function BalancesAfter({ plan, group }: { plan: ImportPlan; group: MoneyGroup }) {
  const nameOf = useNameOf()
  const people = usePeople()
  const balances = useQuery(moneyQueries.balances(supabase, group.id))
  const delta = plan.effects[group.currency] ?? {}
  const now = new Map((balances.data ?? []).map((b) => [b.user_id, b.net_cents]))
  const rows = Object.keys(delta)
    .map((id) => ({ id, now: now.get(id) ?? 0, after: (now.get(id) ?? 0) + delta[id]! }))
    .sort((a, b) => b.after - a.after)
  const scale = Math.max(1, ...rows.map((r) => Math.abs(r.after)))
  const others = Object.entries(plan.effects).filter(([currency]) => currency !== group.currency)

  return (
    <div className="grid gap-3">
      {rows.length > 0 && (
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
                        {t('transfer.import.now', {
                          amount: formatMoney(r.now, group.currency),
                        })}
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
      )}
      {others.map(([currency, effect]) => (
        <Card key={currency} padding="default" className="grid gap-2">
          <p className="text-sm font-semibold">{t('transfer.import.balancesIn', { currency })}</p>
          <ul className="grid gap-1 text-sm">
            {Object.entries(effect)
              .filter(([, cents]) => cents !== 0)
              .sort(([, a], [, b]) => b - a)
              .map(([id, cents]) => (
                <li key={id} className="flex justify-between gap-3">
                  <span>{nameOf(id)}</span>
                  <Money cents={cents} currency={currency} sign="exceptZero" />
                </li>
              ))}
          </ul>
          <p className="text-xs text-mute">
            {t('transfer.import.converted', { currency, group: group.currency })}
          </p>
        </Card>
      ))}
    </div>
  )
}

/** Rates the server will need: the earliest day of each other currency must have one. */
function useMissingRates(plan: ImportPlan | null, groupCurrency: string | undefined): string[] {
  const earliest = useMemo(() => {
    const out = new Map<string, string>()
    for (const row of plan?.rows ?? []) {
      if (!groupCurrency || row.currency === groupCurrency) continue
      const day = row.kind === 'payment' ? row.paid_on : row.spent_at
      const seen = out.get(row.currency)
      if (!seen || day < seen) out.set(row.currency, day)
    }
    return [...out]
  }, [plan, groupCurrency])
  const quotes = useQueries({
    queries: earliest.map(([currency, day]) =>
      moneyQueries.fxRate(supabase, currency, groupCurrency ?? '', day),
    ),
  })
  return earliest.flatMap(([currency, day], i) =>
    quotes[i]?.isSuccess && quotes[i]?.data === null
      ? [
          t('transfer.import.rateMissing', {
            from: currency,
            to: groupCurrency ?? '',
            date: formatDate(day, { timeZone: 'UTC' }),
          }),
        ]
      : [],
  )
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [fileName, setFileName] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [source, setSource] = useState<SourceFile | null>(null)
  const [mapping, setMapping] = useState<(string | null)[]>([])
  const [fromGroup, setFromGroup] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  async function choose(file: File) {
    setReading(true)
    setFailure(null)
    setFileName(file.name)
    try {
      const read = await readFile(file, importLabelSets())
      setSource(read)
      setMapping(
        guessMapping(
          read.people,
          group.members.map((m) => ({ id: m.id, name: m.display_name })),
        ),
      )
      setFromGroup(read.groups.includes(group.name) ? group.name : (read.groups[0] ?? null))
    } finally {
      setReading(false)
    }
  }

  const plan = useMemo(
    () =>
      source
        ? planImport(source, {
            mapping,
            group: fromGroup,
            untitled: t('transfer.import.untitled'),
          })
        : null,
    [source, mapping, fromGroup],
  )
  const missingRates = useMissingRates(plan, group.currency)
  const issues = [...(plan?.issues ?? []).map(issueText), ...missingRates]
  const total = plan?.rows.length ?? 0
  const ready = !!plan && issues.length === 0 && total > 0

  const submit = useMutation({
    mutationFn: () => importExpenses(supabase, group.id, plan!.rows, source!.format),
    onSuccess: async (result) => {
      invalidateMoney(queryClient, group.id)
      toast.success(
        t('transfer.import.done', { count: result.expenses + result.payments, group: group.name }),
      )
      await navigate({ to: '/groups/$groupId', params: { groupId: group.id } })
    },
    onError: (error) => {
      const message = moneyErrorMessage(error)
      const line = plan ? failedLine(plan, (error as { hint?: unknown }).hint) : null
      setFailure(line ? t('transfer.import.rowFailed', { line, message }) : message)
    },
  })

  const members = group.members.map((m) => ({ value: m.id, label: m.display_name }))
  const peopleWithMoney = source
    ? source.people
        .map((name, i) => ({ name, i }))
        .filter(({ i }) =>
          source.entries.some((e) => [e.nets, e.paid, e.shares].some((v) => (v?.[i] ?? 0) !== 0)),
        )
    : []

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
      ) : !source || reading ? (
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
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{fileName}</p>
              <p className="text-sm text-mute">
                {t(`transfer.import.format.${source.format}`)}
                {source.entries.length > 0 &&
                  `, ${t('transfer.import.fileSummary', {
                    count: source.entries.length,
                    people: source.people.join(', '),
                  })}`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSource(null)
                setFailure(null)
              }}
            >
              {t('transfer.import.another')}
            </Button>
          </Card>

          {source.groups.length > 1 && (
            <Field label={t('transfer.import.sourceGroup')}>
              <Select
                value={fromGroup ?? undefined}
                onValueChange={setFromGroup}
                options={source.groups.map((g) => ({ value: g, label: g }))}
              />
            </Field>
          )}

          {peopleWithMoney.length > 0 && (
            <Step title={t('transfer.import.who')}>
              <p className="text-sm text-mute">
                {t('transfer.import.whoHint', { group: group.name })}
              </p>
              <Card padding="roomy" className="grid gap-4 sm:grid-cols-2">
                {peopleWithMoney.map(({ name, i }) => (
                  <Field key={`${name}-${i}`} label={name}>
                    <Select
                      value={mapping[i] ?? undefined}
                      onValueChange={(id) =>
                        setMapping((m) => m.map((value, j) => (j === i ? id : value)))
                      }
                      placeholder={t('transfer.import.notMatched')}
                      options={members}
                    />
                  </Field>
                ))}
              </Card>
            </Step>
          )}

          <IssueList issues={issues} />

          {plan && plan.rows.length > 0 && (
            <Step title={t('transfer.import.preview')}>
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
              {plan.skipped.length > 0 && (
                <p className="text-sm text-mute">
                  {t('transfer.import.skipped', { count: plan.skipped.length })}
                </p>
              )}
              {plan.totals !== 'none' && (
                <p
                  className={cn(
                    'flex items-center gap-2 text-sm font-semibold',
                    plan.totals === 'match' ? 'text-olive-ink' : 'text-saffron-ink',
                  )}
                >
                  {plan.totals === 'match' ? (
                    <Check aria-hidden className="size-4" />
                  ) : (
                    <AlertTriangle aria-hidden className="size-4" />
                  )}
                  {plan.totals === 'match'
                    ? t('transfer.import.totalsMatch')
                    : t('transfer.import.totalsMismatch')}
                </p>
              )}

              <h4 className="mt-2 text-sm font-bold text-mute">{t('transfer.import.balances')}</h4>
              <BalancesAfter plan={plan} group={group} />

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
            disabled={!ready}
            loading={submit.isPending}
            onClick={() => {
              setFailure(null)
              submit.mutate()
            }}
          >
            {submit.isPending
              ? t('transfer.import.importing')
              : t('transfer.import.submit', { count: total })}
          </Button>
        </>
      )}
    </div>
  )
}
