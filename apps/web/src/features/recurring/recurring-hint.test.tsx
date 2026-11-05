import { moneyKeys, type RecurringExpense } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GROUP_ID, ME, renderWithClient, seededClient } from '@/features/expenses/test-utils'
import { RecurringSection } from './recurring-section'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

const rent: RecurringExpense = {
  id: 'r1',
  group_id: GROUP_ID,
  description: 'Rent',
  amount_cents: 145000,
  currency: 'USD',
  paid_by: ME,
  split_type: 'equal',
  category: 'rent',
  splits: [],
  recurrence: 'monthly',
  next_run_on: '2026-12-05',
  active: true,
  created_by: ME,
  created_at: '2026-11-05T00:00:00Z',
  updated_at: '2026-11-05T00:00:00Z',
}

describe('RecurringSection', () => {
  it('says how to change the amount or split, with the guide a tap away', async () => {
    renderWithClient(
      <RecurringSection groupId={GROUP_ID} />,
      seededClient((c) => c.setQueryData(moneyKeys.recurring(GROUP_ID), [rent])),
    )
    fireEvent.click(await screen.findByRole('button', { name: /Repeating/ }))
    expect(screen.getByText(new RegExp(t('help.recurringEdit')))).toBeVisible()
    expect(
      screen.getByRole('link', { name: new RegExp(t('help.topics.recurringEdit')) }),
    ).toHaveAttribute('href', expect.stringContaining('/expenses/recurring/#see-and-manage'))
  })
})
