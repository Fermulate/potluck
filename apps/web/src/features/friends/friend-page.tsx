import {
  blockUser,
  canSplitWithQueryOptions,
  friendsQueryOptions,
  getOrCreateDirectGroup,
  groupKeys,
  moneyKeys,
  myBlocksQueryOptions,
  paymentKeys,
  paymentQueries,
  peopleKeys,
  profilesByIdsQueryOptions,
  removeFriend,
  reportPerson,
  type ExpenseWithSplits,
  type GroupDetail,
  type Settlement,
} from '@potluck/api'
import { dayKey, expenseBetween, friendTotals, settlementBetween } from '@potluck/core'
import { formatMoney, intlLocale, t } from '@potluck/i18n'
import {
  Amount,
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Sheet,
  SheetContent,
  Skeleton,
  TextArea,
  toast,
} from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRightLeft,
  ChevronLeft,
  FileSpreadsheet,
  Flag,
  MoreHorizontal,
  Plus,
  ShieldBan,
  UserMinus,
} from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ExpenseRow, SettlementRow } from '@/features/expenses/expense-row'
import { toBalanceExpense, type ViewerLine } from '@/features/expenses/expense-math'
import { dayLabel, groupByDay } from '@/features/expenses/format'
import { useNameOf, useTimeZone } from '@/features/expenses/money-data'
import { useAccountExports } from '@/features/export-import/use-exports'
import { GroupTile } from '@/features/groups/group-bits'
import { useMyGroups, useMyGroupsRealtime } from '@/features/groups/use-groups'
import { toBalanceSettlement, useLedgers } from './friend-ledger'
import { SettleFriendSheet } from './settle-friend-sheet'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { avatarSrc } from '@/lib/queries'
import { supabase } from '@/lib/supabase'

type HistoryItem =
  | {
      kind: 'expense'
      day: string
      at: string
      group: GroupDetail
      expense: ExpenseWithSplits
      /** What this expense left between the viewer and the friend (`expenseBetween`). */
      line: ViewerLine
    }
  | { kind: 'settlement'; day: string; at: string; group: GroupDetail; settlement: Settlement }

interface Standing {
  group: GroupDetail
  /** Positive: the friend owes the viewer, in the group currency. */
  net: number
}

/**
 * Everything the viewer and a friend share: where they stand in each group, from the same
 * `friend_balances` rows as the friends list (so the two always agree), and every expense and
 * payment between them.
 *
 * Each expense row shows only what it left between the two of them (core `expenseBetween`, the
 * per expense step of `pairwiseDebts` and the one-friend export's between column), never the
 * viewer's whole lead in it. In a group that does not simplify debts the rows and payments add
 * up to the standing there; in one that simplifies, the standing is the simplified debt, which
 * can move money between people, so the rows show the history behind it rather than its sum.
 */
function useSharedLedger(friendId: string) {
  const me = useUserId()
  const timeZone = useTimeZone()
  const { data: groups, isPending: groupsPending } = useMyGroups()
  const balances = useQuery(paymentQueries.friendBalances(supabase))
  const shared = useMemo(
    () => (groups ?? []).filter((g) => g.members.some((m) => m.id === friendId)),
    [groups, friendId],
  )
  const { pending: ledgersPending, byGroup } = useLedgers(shared)
  const pending = groupsPending || ledgersPending || balances.isPending
  const rows = useMemo(
    () => (balances.data ?? []).filter((r) => r.friendId === friendId),
    [balances.data, friendId],
  )

  return useMemo(() => {
    if (pending) {
      return { pending, shared, standings: [] as Standing[], total: undefined, sections: [] }
    }
    const items: HistoryItem[] = []
    for (const group of shared) {
      const ledger = byGroup.get(group.id)!
      for (const e of ledger.expenses) {
        const between = expenseBetween(toBalanceExpense(e), me, friendId, {
          groupCurrency: group.currency,
        })
        if (between === null) continue
        items.push({
          kind: 'expense',
          day: e.spent_at,
          at: e.created_at,
          group,
          expense: e,
          line:
            between > 0
              ? { kind: 'lent', cents: between }
              : between < 0
                ? { kind: 'borrowed', cents: -between }
                : { kind: 'none' },
        })
      }
      for (const s of ledger.settlements) {
        if (!s.deleted_at && settlementBetween(toBalanceSettlement(s), me, friendId)) {
          items.push({
            kind: 'settlement',
            day: dayKey(s.settled_at, timeZone),
            at: s.settled_at,
            group,
            settlement: s,
          })
        }
      }
    }
    items.sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at))
    const standings: Standing[] = shared
      .map((group) => ({
        group,
        net: rows.find((r) => r.groupId === group.id)?.netCents ?? 0,
      }))
      .sort(
        (a, b) =>
          Number(b.group.is_direct) - Number(a.group.is_direct) ||
          Math.abs(b.net) - Math.abs(a.net) ||
          a.group.name.localeCompare(b.group.name),
      )
    const total = friendTotals(rows).get(friendId)
    return { pending, shared, standings, total, sections: groupByDay(items, (item) => item.day) }
  }, [pending, shared, byGroup, rows, me, friendId, timeZone])
}

function StandingLine({ net, currency, name }: { net: number; currency: string; name: string }) {
  if (net === 0) return <span className="text-sm text-mute">{t('friends.settled')}</span>
  const amount = formatMoney(Math.abs(net), currency)
  const label =
    net > 0
      ? t('people.friendPage.owesYou', { name, amount })
      : t('people.friendPage.youOwe', { name, amount })
  return (
    <span className="flex flex-col items-end text-right leading-tight">
      <span className="sr-only">{label}</span>
      <span aria-hidden className="text-xs text-mute">
        {net > 0
          ? t('friends.owesYou', { amount: '' }).trim()
          : t('friends.youOwe', { amount: '' }).trim()}
      </span>
      <Amount
        cents={Math.abs(net)}
        currency={currency}
        locale={intlLocale()}
        tone={net > 0 ? 'owed' : 'owe'}
        className="text-[0.9375rem] font-bold"
        srLabel=""
      />
    </span>
  )
}

function MenuRow({
  icon,
  label,
  hint,
  onClick,
  danger,
}: {
  icon: ReactNode
  label: string
  hint?: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-card p-3 text-left transition-colors hover:bg-sunken"
    >
      <span
        aria-hidden
        className={`grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-5 ${danger ? 'bg-tomato-soft text-tomato-ink' : 'bg-sunken text-ink'}`}
      >
        {icon}
      </span>
      <span>
        <span className={`block font-semibold ${danger ? 'text-tomato-ink' : ''}`}>{label}</span>
        {hint && <span className="block text-sm text-mute">{hint}</span>}
      </span>
    </button>
  )
}

const REPORT_FORM = 'report-person-form'

export function ReportSheet({
  person,
  onOpenChange,
}: {
  person: { id: string; name: string } | null
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!person || !reason.trim()) return
    setBusy(true)
    try {
      await reportPerson(supabase, { userId: person.id, reason })
      toast.success(t('people.report.sent'))
      setReason('')
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={!!person} onOpenChange={onOpenChange}>
      {person && (
        <SheetContent
          title={t('people.report.title', { name: person.name })}
          description={t('people.report.body', { name: person.name })}
          closeLabel={t('common.close')}
          size="sm"
          footer={
            <Button
              type="submit"
              form={REPORT_FORM}
              block
              size="lg"
              loading={busy}
              disabled={!reason.trim()}
            >
              {t('people.report.send')}
            </Button>
          }
        >
          <form id={REPORT_FORM} className="pt-2" onSubmit={onSubmit}>
            <Field label={t('people.report.label')}>
              <TextArea
                required
                rows={4}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('people.report.placeholder')}
              />
            </Field>
          </form>
        </SheetContent>
      )}
    </Sheet>
  )
}

type Pending = 'remove' | 'block' | null

export function FriendPage({ friendId }: { friendId: string }) {
  const me = useUserId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const timeZone = useTimeZone()
  const nameOf = useNameOf()
  const profile = useQuery(profilesByIdsQueryOptions(supabase, [friendId]))
  const friends = useQuery(friendsQueryOptions(supabase, me))
  const ledger = useSharedLedger(friendId)
  const blocks = useQuery(myBlocksQueryOptions(supabase, me))
  const canSplit = useQuery(canSplitWithQueryOptions(supabase, friendId))
  const exports = useAccountExports()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [reporting, setReporting] = useState(false)
  const [opening, setOpening] = useState(false)
  useMyGroupsRealtime('friend-live', FRIEND_TABLES, () => [
    moneyKeys.all,
    groupKeys.all,
    paymentKeys.friendBalances(),
  ])

  const person = profile.data?.[0]
  const isFriend = friends.data?.some((f) => f.id === friendId) ?? false
  const name = person?.display_name ?? ''
  const direct = ledger.shared.find((g) => g.is_direct)
  const overall = (ledger.total?.byCurrency ?? []).map((c) => [c.currency, c.netCents] as const)
  const friend = friends.data?.find((f) => f.id === friendId)
  const [settling, setSettling] = useState(false)
  // A block either way stops new expenses (the server refuses them), so say so up front. Which
  // side blocked is only told to the person who did it.
  const splitNote = blocks.data?.some((b) => b.user_id === friendId)
    ? t('people.friendPage.youBlocked', { name })
    : canSplit.data === false
      ? t('errors.codes.not_a_friend')
      : null

  if (profile.isPending || ledger.pending) return <FriendSkeleton />
  if (!person || person.id === me || person.is_placeholder) {
    return (
      <Frame>
        <EmptyState
          illustration="🫥"
          title={t('people.friendPage.notFound')}
          action={
            <Button asChild variant="secondary">
              <Link to="/friends">{t('people.friendPage.back')}</Link>
            </Button>
          }
        />
      </Frame>
    )
  }

  async function addExpense() {
    setOpening(true)
    try {
      const groupId = direct?.id ?? (await getOrCreateDirectGroup(supabase, friendId))
      if (!direct) void queryClient.invalidateQueries({ queryKey: groupKeys.all })
      await navigate({ to: '/new/expense', search: { groupId } })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setOpening(false)
    }
  }

  async function run(kind: Exclude<Pending, null>) {
    try {
      if (kind === 'remove') {
        await removeFriend(supabase, friendId)
        toast.success(t('people.friendPage.removed', { name }))
      } else {
        await blockUser(supabase, friendId)
        toast.success(t('people.friendPage.blocked', { name }))
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.friends(me) }),
        queryClient.invalidateQueries({ queryKey: peopleKeys.blocks(me) }),
      ])
      await navigate({ to: '/friends', replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Frame>
      <header className="mt-2 flex flex-col items-center gap-3 text-center [--avatar-ring:var(--pl-paper)]">
        <Avatar name={name} seed={person.id} src={avatarSrc(person.avatar_path)} size="xl" />
        <div className="grid gap-1">
          <h1 className="font-display text-4xl leading-tight">{name}</h1>
          {overall.length === 0 ? (
            <p className="flourish text-xl text-mute">{t('people.friendPage.allSettled')}</p>
          ) : (
            overall.map(([currency, net]) => {
              const amount = formatMoney(Math.abs(net), currency)
              return (
                <p key={currency} className="text-lg">
                  <span className="sr-only">
                    {net > 0
                      ? t('people.friendPage.owesYou', { name, amount })
                      : t('people.friendPage.youOwe', { name, amount })}
                  </span>
                  <span aria-hidden className="text-mute">
                    {net > 0 ? t('balances.youAreOwedTotal') : t('balances.youOweTotal')}{' '}
                  </span>
                  <Amount
                    cents={Math.abs(net)}
                    currency={currency}
                    locale={intlLocale()}
                    tone={net > 0 ? 'owed' : 'owe'}
                    className="text-2xl font-extrabold"
                    srLabel=""
                  />
                </p>
              )
            })
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            leadingIcon={<Plus />}
            loading={opening}
            disabled={splitNote !== null}
            aria-describedby={splitNote ? 'friend-split-note' : undefined}
            onClick={() => void addExpense()}
          >
            {t('people.friendPage.addExpense')}
          </Button>
          {friend && ledger.total && ledger.total.settleable.length > 0 && (
            <Button
              variant="secondary"
              leadingIcon={<ArrowRightLeft />}
              onClick={() => setSettling(true)}
            >
              {t('people.friendPage.settleUp')}
            </Button>
          )}
          <IconButton
            variant="secondary"
            label={t('people.friendPage.menu', { name })}
            icon={<MoreHorizontal />}
            onClick={() => setMenuOpen(true)}
          />
        </div>
        {splitNote && (
          <p id="friend-split-note" className="max-w-sm text-sm text-pretty text-mute">
            {splitNote}
          </p>
        )}
      </header>

      {ledger.standings.length > 0 && (
        <section
          aria-labelledby="friend-standing"
          className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-2"
        >
          <h2 id="friend-standing" className="px-1 text-sm font-bold tracking-tight text-mute">
            {t('people.friendPage.sharedGroups')}
          </h2>
          <ul className="grid gap-2">
            {ledger.standings.map(({ group, net }) => (
              <li key={group.id}>
                <Link
                  to="/groups/$groupId"
                  params={{ groupId: group.id }}
                  className="flex items-center gap-3 rounded-card border border-line bg-card p-3 transition-colors hover:border-ink/25"
                >
                  {group.is_direct ? (
                    <Avatar
                      name={name}
                      seed={person.id}
                      src={avatarSrc(person.avatar_path)}
                      size="sm"
                    />
                  ) : (
                    <GroupTile emoji={group.emoji} color={group.color} size="sm" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {group.is_direct ? t('people.friendPage.oneOnOne') : group.name}
                  </span>
                  <StandingLine net={net} currency={group.currency} name={name} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="friend-history"
        className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4"
      >
        <h2 id="friend-history" className="px-1 text-sm font-bold tracking-tight text-mute">
          {t('people.friendPage.history')}
        </h2>
        {ledger.sections.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-strong p-4 text-sm text-pretty text-mute">
            {t('people.friendPage.historyEmpty')}
          </p>
        ) : (
          ledger.sections.map((section) => (
            <section key={section.day} aria-labelledby={`friend-day-${section.day}`}>
              <h3
                id={`friend-day-${section.day}`}
                className="mb-2 px-1 text-sm font-bold tracking-tight text-mute"
              >
                {dayLabel(section.day, timeZone)}
              </h3>
              <Card padding="none" className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {section.items.map((item) => {
                    return (
                      <li key={item.kind === 'expense' ? item.expense.id : item.settlement.id}>
                        <p className="-mb-1.5 flex items-center gap-1.5 px-4 pt-2.5 text-xs font-semibold text-mute">
                          {item.group.is_direct
                            ? t('people.friendPage.oneOnOne')
                            : t('people.friendPage.inGroup', { group: item.group.name })}
                        </p>
                        {item.kind === 'expense' ? (
                          <ExpenseRow
                            expense={item.expense}
                            viewerId={me}
                            nameOf={nameOf}
                            groupCurrency={item.group.currency}
                            locale={intlLocale()}
                            line={item.line}
                            noneLabel={t('people.friendPage.nothingBetween')}
                          />
                        ) : (
                          <SettlementRow
                            settlement={item.settlement}
                            viewerId={me}
                            nameOf={nameOf}
                            locale={intlLocale()}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </Card>
            </section>
          ))
        )}
      </section>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent title={name} closeLabel={t('common.close')} size="sm">
          <div className="grid gap-1">
            <MenuRow
              icon={<FileSpreadsheet />}
              label={t('people.friendPage.export')}
              hint={t('transfer.yourData.friendHint')}
              onClick={() => {
                setMenuOpen(false)
                void exports.friend(person.id, person.display_name)
              }}
            />
            {isFriend && (
              <MenuRow
                icon={<UserMinus />}
                label={t('people.friendPage.remove')}
                hint={t('people.friendPage.removeHint')}
                onClick={() => {
                  setMenuOpen(false)
                  setPending('remove')
                }}
              />
            )}
            <MenuRow
              icon={<Flag />}
              label={t('people.friendPage.report', { name })}
              hint={t('people.friendPage.reportHint')}
              onClick={() => {
                setMenuOpen(false)
                setReporting(true)
              }}
            />
            <MenuRow
              danger
              icon={<ShieldBan />}
              label={t('people.friendPage.block', { name })}
              hint={t('people.friendPage.blockHint')}
              onClick={() => {
                setMenuOpen(false)
                setPending('block')
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={
            pending === 'remove'
              ? t('people.friendPage.remove')
              : t('people.friendPage.block', { name })
          }
          description={
            pending === 'remove'
              ? t('people.friendPage.removeConfirm', { name })
              : t('people.friendPage.blockConfirm', { name })
          }
          confirmLabel={pending === 'remove' ? t('common.remove') : t('members.block')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          tone="danger"
          onConfirm={() => run(pending)}
        />
      )}

      {settling && friend && ledger.total && (
        <SettleFriendSheet
          friend={friend}
          total={ledger.total}
          open
          onOpenChange={(o) => !o && setSettling(false)}
        />
      )}

      <ReportSheet
        person={reporting ? { id: person.id, name } : null}
        onOpenChange={(open) => !open && setReporting(false)}
      />
    </Frame>
  )
}

const FRIEND_TABLES = [{ table: 'expenses' }, { table: 'settlements' }, { table: 'group_members' }]

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-32 lg:px-8 lg:pt-10 lg:pb-12">
      <Link
        to="/friends"
        className="-ml-2 inline-flex h-11 items-center gap-1 rounded-pill pr-3 pl-1 text-sm font-semibold text-mute hover:text-ink"
      >
        <ChevronLeft aria-hidden className="size-5" />
        {t('people.friendPage.back')}
      </Link>
      {children}
    </div>
  )
}

function FriendSkeleton() {
  return (
    <Frame>
      <div className="mt-2 flex flex-col items-center gap-3" aria-hidden>
        <Skeleton shape="circle" className="size-20" />
        <Skeleton shape="line" className="h-9 w-48" />
        <Skeleton shape="line" className="w-32" />
      </div>
      <div className="mt-8 grid gap-2" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    </Frame>
  )
}
