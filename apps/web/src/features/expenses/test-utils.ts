import {
  meKeys,
  moneyKeys,
  type ExpenseWithSplits,
  type MoneyGroup,
  type MoneyMember,
} from '@potluck/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'

export const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
export const BEN = 'bbbbbbbb-0000-4000-8000-000000000002'
export const CLEO = 'cccccccc-0000-4000-8000-000000000003'
export const GROUP_ID = '10000000-0000-4000-8000-000000000001'

const member = (id: string, display_name: string): MoneyMember => ({
  id,
  display_name,
  avatar_path: null,
  deleted_at: null,
  role: 'member',
})

export const members = [
  member(ME, 'Ava Chen'),
  member(BEN, 'Ben Okafor'),
  member(CLEO, 'Cleo Park'),
]

export const group: MoneyGroup = {
  id: GROUP_ID,
  name: 'Hike crew',
  emoji: '🥾',
  color: null,
  currency: 'USD',
  simplify_debts: true,
  is_direct: false,
  archived_at: null,
  members,
}

export function expense(patch: Partial<ExpenseWithSplits>): ExpenseWithSplits {
  return {
    id: 'e0000000-0000-4000-8000-000000000001',
    group_id: GROUP_ID,
    event_id: null,
    description: 'Tacos',
    amount_cents: 3000,
    currency: 'USD',
    fx_rate: 1,
    paid_by: ME,
    split_type: 'equal',
    category: 'food',
    notes: null,
    spent_at: '2026-11-04',
    receipt_path: null,
    recurring_id: null,
    created_by: ME,
    created_at: '2026-11-04T18:00:00Z',
    updated_at: '2026-11-04T18:00:00Z',
    deleted_at: null,
    expense_splits: [
      { user_id: ME, share_cents: 1000, weight: null },
      { user_id: BEN, share_cents: 1000, weight: null },
      { user_id: CLEO, share_cents: 1000, weight: null },
    ],
    ...patch,
  }
}

/** A query client pre-filled the way the API would answer, so nothing hits the network. */
export function seededClient(seed: (client: QueryClient) => void = () => {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
  client.setQueryData(meKeys.profile(ME), {
    id: ME,
    display_name: 'Ava Chen',
    avatar_path: null,
    deleted_at: null,
    timezone: 'America/Los_Angeles',
    default_currency: 'USD',
    locale: 'en',
  })
  client.setQueryData(moneyKeys.people(), members)
  client.setQueryData(moneyKeys.groupInfo(GROUP_ID), group)
  client.setQueryData(moneyKeys.recurring(GROUP_ID), [])
  seed(client)
  return client
}

export function renderWithClient(ui: ReactElement, client = seededClient()) {
  return { client, ...render(createElement(QueryClientProvider, { client }, ui)) }
}
