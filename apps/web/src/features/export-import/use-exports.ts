import { exportMyData, moneyQueries } from '@potluck/api'
import { backupLedger, ledgerCsv, ledgerPeople, type Backup } from '@potluck/core'
import { t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { groupCsv } from '@/features/expenses/expense-math'
import { categoryLabel } from '@/features/expenses/format'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { fileName, saveFile } from './download'
import { ledgerLabels } from './labels'

/** Runs one export at a time, says where the file went, and reports a failure. */
function useRunner<K extends string>() {
  const [busy, setBusy] = useState<K | null>(null)
  const run = async (key: K, work: () => Promise<string>) => {
    if (busy) return
    setBusy(key)
    try {
      const file = await work()
      toast.success(t('transfer.saved', { file }))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

/** The group's spreadsheet, from the same data the expenses tab shows. */
export function useGroupExport(groupId: string) {
  const queryClient = useQueryClient()
  const { busy, run } = useRunner<'group'>()
  const exportGroup = () =>
    run('group', async () => {
      const [group, expenses, settlements, people] = await Promise.all([
        queryClient.fetchQuery(moneyQueries.group(supabase, groupId)),
        queryClient.fetchQuery(moneyQueries.expenses(supabase, groupId)),
        queryClient.fetchQuery(moneyQueries.settlements(supabase, groupId)),
        queryClient.fetchQuery(moneyQueries.people(supabase)),
      ])
      const file = fileName(group.name, 'csv', 'expenses')
      saveFile(
        file,
        groupCsv(group, expenses, settlements, new Map(people.map((p) => [p.id, p]))),
        'csv',
      )
      return file
    })
  return { exportGroup, busy: busy !== null }
}

/** Everyone in a backup as spreadsheet columns: the viewer first, then by name. */
function everyone(backup: Backup) {
  const { nameOf } = backupLedger(backup, t('transfer.csv.someoneWhoLeft'))
  const ids = new Set<string>()
  for (const g of backup.groups) {
    for (const m of g.members) ids.add(m.user_id)
    for (const e of g.expenses) {
      for (const p of e.payers) ids.add(p.user_id)
      for (const s of e.splits) ids.add(s.user_id)
    }
    for (const p of g.payments) ids.add(p.from_user).add(p.to_user)
  }
  ids.delete(backup.profile.id)
  const others = [...ids]
    .map((id) => ({ id, name: nameOf(id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return ledgerPeople(
    [{ id: backup.profile.id, name: backup.profile.display_name }, ...others],
    [],
    nameOf,
  )
}

function accountCsv(backup: Backup, friend?: string): string {
  const { groups, nameOf } = backupLedger(backup, t('transfer.csv.someoneWhoLeft'))
  return ledgerCsv(groups, {
    labels: ledgerLabels(),
    people: everyone(backup),
    paymentText: (from, to) =>
      t('transfer.import.rowPayment', { from: nameOf(from), to: nameOf(to) }),
    friend: friend ? { me: backup.profile.id, friend } : undefined,
    nameOf,
    categoryLabel,
  })
}

/** The account wide exports on Me: the JSON backup, everything as CSV, one friend as CSV. */
export function useAccountExports() {
  const { busy, run } = useRunner<'backup' | 'everything' | 'friend'>()
  return {
    busy,
    backup: () =>
      run('backup', async () => {
        const backup = await exportMyData(supabase)
        const file = fileName('potluck-backup', 'json')
        saveFile(file, JSON.stringify(backup, null, 2), 'json')
        return file
      }),
    everything: () =>
      run('everything', async () => {
        const backup = await exportMyData(supabase)
        const file = fileName('potluck', 'csv')
        saveFile(file, accountCsv(backup), 'csv')
        return file
      }),
    friend: (friendId: string, friendName: string) =>
      run('friend', async () => {
        const backup = await exportMyData(supabase)
        const file = fileName(friendName, 'csv', 'friend')
        saveFile(file, accountCsv(backup, friendId), 'csv')
        return file
      }),
  }
}
