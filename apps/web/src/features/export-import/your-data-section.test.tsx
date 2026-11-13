import type * as Api from '@potluck/api'
import { exportMyData, groupKeys, moneyKeys } from '@potluck/api'
import type { Backup } from '@potluck/core'
import { t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderInRouter } from '@/features/expenses/router-test-utils'
import { BEN, CLEO, GROUP_ID, ME, expense, seededClient } from '@/features/expenses/test-utils'
import type * as Download from './download'
import { saveFile } from './download'
import { GroupDataSection } from './group-data-section'
import { YourDataSection } from './your-data-section'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('./download', async (importOriginal) => ({
  ...(await importOriginal<typeof Download>()),
  saveFile: vi.fn(),
}))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  exportMyData: vi.fn(),
}))

// Radix scrolls the picked option into view; jsdom cannot scroll.
Element.prototype.scrollIntoView ??= () => {}

const save = vi.mocked(saveFile)
const at = '2026-03-01T12:00:00+00:00'
const backup: Backup = {
  format: 'potluck-backup',
  version: 1,
  exported_at: at,
  profile: {
    id: ME,
    display_name: 'Ava Chen',
    email: 'ava@example.com',
    avatar_path: null,
    timezone: 'UTC',
    default_currency: 'USD',
    locale: 'en',
    created_at: at,
  },
  people: [
    { id: ME, display_name: 'Ava Chen', deleted: false },
    { id: BEN, display_name: 'Ben Okafor', deleted: false },
    { id: CLEO, display_name: 'Cleo Park', deleted: false },
  ],
  friends: [BEN, CLEO],
  groups: [
    {
      id: GROUP_ID,
      name: 'Hike crew',
      emoji: null,
      color: null,
      currency: 'USD',
      is_direct: false,
      simplify_debts: true,
      members_can_invite: true,
      default_split: null,
      created_by: ME,
      created_at: at,
      archived_at: null,
      members: [ME, BEN, CLEO].map((user_id) => ({ user_id, role: 'member', joined_at: at })),
      expenses: [
        {
          id: 'e0000000-0000-4000-8000-000000000001',
          description: 'Snacks',
          amount_cents: 3000,
          currency: 'USD',
          fx_rate: '1.000000000000',
          is_refund: false,
          split_type: 'equal',
          category: 'food',
          notes: null,
          spent_at: '2026-03-01',
          tax_cents: null,
          tip_cents: null,
          discount_cents: null,
          event_id: null,
          recurring_id: null,
          receipt_path: null,
          created_by: ME,
          created_at: at,
          updated_at: at,
          deleted_at: null,
          payers: [{ user_id: ME, paid_cents: 3000 }],
          splits: [ME, BEN, CLEO].map((user_id) => ({
            user_id,
            share_cents: 1000,
            weight: null,
            adjustment_cents: null,
          })),
          items: [],
          comments: [],
        },
      ],
      payments: [],
      recurring: [],
      plans: [],
    },
  ],
}

const friend = (id: string, display_name: string): Api.Friend => ({
  id,
  display_name,
  avatar_path: null,
  deleted_at: null,
  direct_group_id: null,
  net_cents: 0,
  currency: null,
})

function renderSection(friends: Api.Friend[] = [friend(BEN, 'Ben Okafor')]) {
  return renderInRouter(
    <YourDataSection />,
    seededClient((c) => c.setQueryData(groupKeys.friends(ME), friends)),
  )
}

describe('YourDataSection', () => {
  beforeEach(() => {
    save.mockClear()
    vi.mocked(exportMyData).mockResolvedValue(backup)
  })

  it('downloads the whole account as JSON', async () => {
    const success = vi.spyOn(toast, 'success')
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: t('transfer.yourData.backup') }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const [name, content, type] = save.mock.calls[0]!
    expect(name).toMatch(/^potluck-backup-\d{4}-\d{2}-\d{2}\.json$/)
    expect(type).toBe('json')
    expect(JSON.parse(content)).toEqual(backup)
    expect(success).toHaveBeenCalledWith(t('transfer.saved', { file: name }))
  })

  it('exports every group as one spreadsheet that ends on the balances', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: t('transfer.yourData.everything') }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const lines = save.mock.calls[0]![1].trim().split('\r\n')
    expect(lines[0]).toContain('Ava Chen paid,Ava Chen share,Ava Chen balance,Ben Okafor paid')
    expect(lines[1]).toMatch(/^2026-03-01,Hike crew,Expense,Snacks,Food,30.00/)
    expect(lines[2]).toBe(',Hike crew,Balance,,,,,,USD,,,,,20.00,,,-10.00,,,-10.00,,')
  })

  it('exports what you share with one friend', async () => {
    renderSection([friend(BEN, 'Ben Okafor'), friend(CLEO, 'Cleo Park')])
    const go = await screen.findByRole('button', { name: t('transfer.yourData.friendExport') })
    expect(go).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('combobox', { name: t('transfer.yourData.friendLabel') }), {
      key: 'Enter',
    })
    fireEvent.click(await screen.findByRole('option', { name: 'Cleo Park' }))
    fireEvent.click(go)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const [name, content] = save.mock.calls[0]!
    expect(name).toMatch(/^cleo-park-/)
    const lines = content.trim().split('\r\n')
    expect(lines[0]).toContain('Cleo Park share,Between you and Cleo Park,Notes')
    expect(lines.at(-1)).toContain(',Hike crew,Balance,')
    expect(lines.at(-1)).toContain('10.00')
  })

  it('says there is no one to export with yet, and reports a failure', async () => {
    const error = vi.spyOn(toast, 'error')
    vi.mocked(exportMyData).mockRejectedValueOnce(new Error('offline'))
    renderSection([])
    expect(await screen.findByText(t('transfer.yourData.noFriends'))).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t('transfer.yourData.backup') }))
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(save).not.toHaveBeenCalled()
  })
})

describe('GroupDataSection', () => {
  beforeEach(() => save.mockClear())

  it('exports the group from what the expenses tab has loaded', async () => {
    renderInRouter(
      <GroupDataSection groupId={GROUP_ID} archived={false} />,
      seededClient((c) => {
        c.setQueryData(moneyKeys.expenses(GROUP_ID), [expense({})])
        c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: t('transfer.group.export') }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const [name, content, type] = save.mock.calls[0]!
    expect(name).toMatch(/^hike-crew-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(type).toBe('csv')
    expect(content).toContain('2026-11-04,Hike crew,Expense,Tacos')
    expect(await screen.findByRole('link', { name: t('transfer.group.import') })).toHaveAttribute(
      'href',
      `/groups/${GROUP_ID}/import`,
    )
  })

  it('points archived groups at unarchiving first', async () => {
    renderInRouter(<GroupDataSection groupId={GROUP_ID} archived />)
    expect(await screen.findByText(t('transfer.group.importArchived'))).toBeVisible()
    expect(screen.queryByRole('link', { name: t('transfer.group.import') })).not.toBeInTheDocument()
  })
})
