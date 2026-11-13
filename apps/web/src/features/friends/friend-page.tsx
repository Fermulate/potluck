import {
  blockUser,
  friendsQueryOptions,
  getOrCreateDirectGroup,
  groupKeys,
  moneyKeys,
  moneyQueries,
  peopleKeys,
  profilesByIdsQueryOptions,
  removeFriend,
  reportPerson,
  type ExpenseWithSplits,
  type GroupDetail,
  type Settlement,
} from '@potluck/api'
import { dayKey, expenseInvolvesBoth, netBetween, settlementBetween } from '@potluck/core'
import { DEFAULT_LOCALE, formatMoney, t } from '@potluck/i18n'
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
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRightLeft,
  ChevronLeft,
  Flag,
  MoreHorizontal,
  Plus,
  ShieldBan,
  UserMinus,
} from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ExpenseRow, SettlementRow } from '@/features/expenses/expense-row'
import { toBalanceExpense } from '@/features/expenses/expense-math'
import { dayLabel, groupByDay } from '@/features/expenses/format'
import { useNameOf, useTimeZone } from '@/features/expenses/money-data'
import { GroupTile } from '@/features/groups/group-bits'
import { useMyGroups, useMyGroupsRealtime } from '@/features/groups/use-groups'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { avatarSrc } from '@/lib/queries'
import { supabase } from '@/lib/supabase'

type HistoryItem =
  | { kind: 'expense'; day: string; at: string; group: GroupDetail; expense: ExpenseWithSplits }
  | { kind: 'settlement'; day: string; at: string; group: GroupDetail; settlement: Settlement }

interface Standing {
  group: GroupDetail
  /** Positive: the friend owes the viewer, in the group currency. */
  net: number
}

/**
 * Everything the viewer and a friend share: where they stand in each group (pairwise, the same
 * rule as the balances tab with simplify off) and every expense and payment between them.
 */
function useSharedLedger(friendId: string) {
  const me = useUserId()
  const timeZone = useTimeZone()
  const { data: groups, isPending: groupsPending } = useMyGroups()
  const shared = useMemo(
    () => (groups ?? []).filter((g) => g.members.some((m) => m.id === friendId)),
    [groups, friendId],
  )
  const expenses = useQueries({
    queries: shared.map((g) => moneyQueries.expenses(supabase, g.id)),
  })
  const settlements = useQueries({
    queries: shared.map((g) => moneyQueries.settlements(supabase, g.id)),
  })
  const pending =
    groupsPending || expenses.some((q) => q.isPending) || settlements.some((q) => q.isPending)

  return useMemo(() => {
    const standings: Standing[] = []
    const items: HistoryItem[] = []
    if (pending) return { pending, shared, standings, sections: [] }
    shared.forEach((group, i) => {
      const groupExpenses = (expenses[i]?.data ?? []).map((e) => ({
        row: e,
        balance: toBalanceExpense(e),
      }))
      const groupSettlements = (settlements[i]?.data ?? []).map((s) => ({
        row: s,
        balance: {
          fromUser: s.from_user,
          toUser: s.to_user,
          amountCents: s.amount_cents,
          currency: s.currency,
          fxRate: s.fx_rate,
          deletedAt: s.deleted_at,
        },
      }))
      standings.push({
        group,
        net: netBetween(
          groupExpenses.map((e) => e.balance),
          groupSettlements.map((s) => s.balance),
          me,
          friendId,
          { groupCurrency: group.currency },
        ),
      })
      for (const e of groupExpenses) {
        if (expenseInvolvesBoth(e.balance, me, friendId)) {
          items.push({
            kind: 'expense',
            day: e.row.spent_at,
            at: e.row.created_at,
            group,
            expense: e.row,
          })
        }
      }
      for (const s of groupSettlements) {
        if (!s.row.deleted_at && settlementBetween(s.balance, me, friendId)) {
          items.push({
            kind: 'settlement',
            day: dayKey(s.row.settled_at, timeZone),
            at: s.row.settled_at,
            group,
            settlement: s.row,
          })
        }
      }
    })
    items.sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at))
    standings.sort(
      (a, b) =>
        Number(b.group.is_direct) - Number(a.group.is_direct) ||
        Math.abs(b.net) - Math.abs(a.net) ||
        a.group.name.localeCompare(b.group.name),
    )
    return { pending, shared, standings, sections: groupByDay(items, (item) => item.day) }
  }, [pending, shared, expenses, settlements, me, friendId, timeZone])
}

/** Net per currency across every shared group. */
function totals(standings: Standing[]) {
  const sums = new Map<string, number>()
  for (const s of standings) sums.set(s.group.currency, (sums.get(s.group.currency) ?? 0) + s.net)
  return [...sums].filter(([, net]) => net !== 0)
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
        locale={DEFAULT_LOCALE}
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [reporting, setReporting] = useState(false)
  const [opening, setOpening] = useState(false)
  useMyGroupsRealtime('friend-live', FRIEND_TABLES, () => [moneyKeys.all, groupKeys.all])

  const person = profile.data?.[0]
  const isFriend = friends.data?.some((f) => f.id === friendId) ?? false
  const name = person?.display_name ?? ''
  const direct = ledger.shared.find((g) => g.is_direct)
  const overall = totals(ledger.standings)
  const directNet = ledger.standings.find((s) => s.group.is_direct)?.net ?? 0

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
                    {t('people.friendPage.overall')}{' '}
                  </span>
                  <Amount
                    cents={Math.abs(net)}
                    currency={currency}
                    locale={DEFAULT_LOCALE}
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
          <Button leadingIcon={<Plus />} loading={opening} onClick={() => void addExpense()}>
            {t('people.friendPage.addExpense')}
          </Button>
          {direct && directNet < 0 && (
            <Button asChild variant="secondary" leadingIcon={<ArrowRightLeft />}>
              <Link
                to="/new/settle"
                search={{ groupId: direct.id, to: friendId, amount: -directNet }}
              >
                {t('people.friendPage.settleUp')}
              </Link>
            </Button>
          )}
          <IconButton
            variant="secondary"
            label={t('people.friendPage.menu', { name })}
            icon={<MoreHorizontal />}
            onClick={() => setMenuOpen(true)}
          />
        </div>
      </header>

      {ledger.standings.length > 0 && (
        <section aria-labelledby="friend-standing" className="mt-8 grid gap-2">
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

      <section aria-labelledby="friend-history" className="mt-8 grid gap-4">
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
                            locale={DEFAULT_LOCALE}
                          />
                        ) : (
                          <SettlementRow
                            settlement={item.settlement}
                            viewerId={me}
                            nameOf={nameOf}
                            locale={DEFAULT_LOCALE}
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
