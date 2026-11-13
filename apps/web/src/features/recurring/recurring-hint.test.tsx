import { moneyKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { GROUP_ID, seededClient } from '@/features/expenses/test-utils'
import { RecurringSection } from './recurring-section'
import { template } from './test-utils'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

describe('RecurringSection', () => {
  it('says how to change the amount or split, with the guide a tap away', async () => {
    renderWithProviders(<RecurringSection groupId={GROUP_ID} />, {
      client: seededClient((c) => c.setQueryData(moneyKeys.recurring(GROUP_ID), [template()])),
    })
    fireEvent.click(await screen.findByRole('button', { name: /Repeating/ }))
    expect(screen.getByText(new RegExp(t('help.recurringEdit')))).toBeVisible()
    expect(
      screen.getByRole('link', { name: new RegExp(t('help.topics.recurringEdit')) }),
    ).toHaveAttribute('href', expect.stringContaining('/expenses/recurring/#see-and-manage'))
  })

  it('opens each repeating expense from its row', async () => {
    renderWithProviders(<RecurringSection groupId={GROUP_ID} />, {
      client: seededClient((c) => c.setQueryData(moneyKeys.recurring(GROUP_ID), [template()])),
    })
    fireEvent.click(await screen.findByRole('button', { name: /Repeating/ }))
    expect(screen.getByRole('link', { name: /^Rent/ })).toHaveAttribute('href', '/recurring/r1')
  })

  it('names every payer when several people pay', async () => {
    renderWithProviders(<RecurringSection groupId={GROUP_ID} />, {
      client: seededClient((c) =>
        c.setQueryData(moneyKeys.recurring(GROUP_ID), [
          template({
            payers: [
              { user_id: 'aaaaaaaa-0000-4000-8000-000000000001', paid_cents: 100000 },
              { user_id: 'bbbbbbbb-0000-4000-8000-000000000002', paid_cents: 50000 },
            ],
            recurrence: 'biweekly',
          }),
        ]),
      ),
    })
    fireEvent.click(await screen.findByRole('button', { name: /Repeating/ }))
    expect(screen.getByText('Every 2 weeks, You and Ben paid $1,500.00')).toBeVisible()
  })
})
