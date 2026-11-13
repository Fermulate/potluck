import { moneyKeys, setDefaultSplit, type DefaultSplit, type MoneyGroup } from '@potluck/api'
import { intlLocale, t } from '@potluck/i18n'
import { Button, Card, Sheet, SheetContent, toast } from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { namesOf } from '@/features/expenses/expense-math'
import { SplitEditor } from '@/features/expenses/form/split-editor'
import {
  defaultFromDraft,
  initialDraft,
  isEqualBetweenAll,
  matchesDefault,
  splitErrorText,
  previewSplit,
  type SplitDraft,
} from '@/features/expenses/form/split-state'
import { moneyErrorMessage, useMoneyGroup, useNameOf } from '@/features/expenses/money-data'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

const MODES = ['equal', 'percent', 'shares'] as const

/** "Equally between everyone", "By percent: you 60%, Ben 40%", "By shares: you 2, Ben 1". */
function summary(
  split: DefaultSplit | null,
  group: MoneyGroup,
  me: string,
  nameOf: ReturnType<typeof useNameOf>,
): string {
  const memberIds = new Set(group.members.map((m) => m.id))
  const people = (split?.splits ?? []).filter((s) => memberIds.has(s.user_id))
  if (!split || people.length === 0) return t('groups.settings.defaultSplit.equalAll')
  const ids = people.map((p) => p.user_id)
  const weight = new Map(people.map((p) => [p.user_id, p.weight ?? 0]))
  const label = (suffix: string) =>
    namesOf(ids, me, (id, o) => `${nameOf(id, o)} ${weight.get(id)}${suffix}`, {
      start: false,
      max: 6,
    })
  switch (split.split_type) {
    case 'percent':
      return t('groups.settings.defaultSplit.percent', { people: label('%') })
    case 'shares':
      return t('groups.settings.defaultSplit.shares', { people: label('') })
    default:
      return ids.length === group.members.length
        ? t('groups.settings.defaultSplit.equalAll')
        : t('groups.settings.defaultSplit.equalSome', {
            people: namesOf(ids, me, nameOf, { start: false, max: 6 }),
          })
  }
}

/**
 * Group settings: where new expenses start. The same editor as the expense form, limited to the
 * splits that make sense without an amount (equal, percent, shares). Any member may change it,
 * like in Splitwise; it never moves a balance.
 */
export function DefaultSplitSection({ groupId }: { groupId: string }) {
  const me = useUserId()
  const nameOf = useNameOf()
  const queryClient = useQueryClient()
  const group = useMoneyGroup(groupId)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SplitDraft | null>(null)
  const save = useMutation({
    mutationFn: (split: DefaultSplit | null) => setDefaultSplit(supabase, groupId, split),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: moneyKeys.groupInfo(groupId) })
      toast.success(
        saved ? t('groups.settings.defaultSplit.saved') : t('groups.settings.defaultSplit.cleared'),
      )
      setOpen(false)
    },
    onError: (error) => toast.error(moneyErrorMessage(error)),
  })
  if (!group.data || group.data.is_direct) return null
  const data = group.data
  const memberIds = data.members.map((m) => m.id)
  const current = draft ?? initialDraft(memberIds, data.default_split)
  // The check needs an amount; any positive one tells whether the split itself is valid.
  const problem = splitErrorText(previewSplit(current, 10000))
  const plainEqual = isEqualBetweenAll(current, memberIds)
  const next = plainEqual ? null : defaultFromDraft(current)
  const unchanged = plainEqual
    ? !data.default_split
    : !next || matchesDefault(current, data.default_split)

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-mute">{t('groups.settings.defaultSplit.title')}</h3>
        <Help topic="defaultSplit" />
      </div>
      <Card padding="roomy" className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{summary(data.default_split, data, me, nameOf)}</p>
          <p className="mt-0.5 text-sm text-mute">{t('groups.settings.defaultSplit.hint')}</p>
        </div>
        <Button
          variant="secondary"
          disabled={!!data.archived_at}
          onClick={() => {
            setDraft(initialDraft(memberIds, data.default_split))
            setOpen(true)
          }}
        >
          {t('groups.settings.defaultSplit.change')}
        </Button>
      </Card>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          title={t('groups.settings.defaultSplit.title')}
          description={t('groups.settings.defaultSplit.hint')}
          closeLabel={t('common.close')}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              {problem ? (
                <p role="alert" className="text-sm font-medium text-tomato-ink">
                  {problem}
                </p>
              ) : data.default_split ? (
                <Button variant="ghost" onClick={() => save.mutate(null)}>
                  {t('groups.settings.defaultSplit.clear')}
                </Button>
              ) : (
                <span />
              )}
              <Button
                loading={save.isPending}
                disabled={!!problem || unchanged}
                onClick={() => save.mutate(next)}
              >
                {t('groups.settings.defaultSplit.save')}
              </Button>
            </div>
          }
        >
          <SplitEditor
            members={data.members}
            viewerId={me}
            draft={current}
            onChange={setDraft}
            amountCents={0}
            currency={data.currency}
            locale={intlLocale()}
            modes={MODES}
            showAmounts={false}
          />
        </SheetContent>
      </Sheet>
    </section>
  )
}
