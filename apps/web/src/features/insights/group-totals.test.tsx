import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { GROUP_ID, ME, seededClient } from '../expenses/test-utils'
import { GroupTotals } from './group-totals'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

const row = (patch: object) => ({
  group_id: GROUP_ID,
  currency: 'USD',
  month: '2026-03-01',
  category: null,
  expense_count: 0,
  spend_cents: 0,
  paid_cents: 0,
  share_cents: 0,
  payments_made_cents: 0,
  payments_received_cents: 0,
  ...patch,
})

// The flat from the pgTAP and core tests: tacos and groceries in March, the hotel in April.
const flat = [
  row({
    category: 'food',
    expense_count: 1,
    spend_cents: 9000,
    paid_cents: 9000,
    share_cents: 3000,
  }),
  row({ category: 'groceries', expense_count: 1, spend_cents: 1200, share_cents: 400 }),
  row({
    month: '2026-04-01',
    category: 'lodging',
    expense_count: 1,
    spend_cents: 11000,
    share_cents: 5500,
  }),
  row({ month: '2026-04-01', payments_received_cents: 3000 }),
]

function renderTotals(rows: object[] = flat) {
  resetDb().respond('rpc:spending_summary', { data: rows })
  return renderWithProviders(<GroupTotals groupId={GROUP_ID} />, {
    path: '/groups/$groupId/totals',
    url: `/groups/${GROUP_ID}/totals`,
    client: seededClient(),
  })
}

const totals = () => screen.getByRole('region', { name: t('insights.totals.label') })
/** The period the screen shows ("March 2026", "2026", "Since the beginning"). */
const period = (text: string) => screen.findByText(text, { selector: 'p[aria-live]' })

describe('GroupTotals', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T18:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('opens on this month with the viewer share and every total', async () => {
    renderTotals()
    await screen.findByRole('region', { name: t('insights.totals.label') })
    expect(db().rpcArgs('spending_summary')).toEqual([{ in_group: GROUP_ID }])
    expect(await period('March 2026')).toBeInTheDocument()
    await waitFor(() => expect(within(totals()).getByText('$34.00')).toBeInTheDocument())
    expect(within(totals()).getByText('$102.00')).toBeInTheDocument()
    expect(within(totals()).getByText('$90.00')).toBeInTheDocument()
    expect(
      within(totals()).getByText(t('insights.totals.netUp', { amount: '$56.00' })),
    ).toBeInTheDocument()
    const categories = screen.getByRole('list', { name: t('insights.byCategory.title') })
    expect(
      within(categories)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('$30.00'), expect.stringContaining('$4.00')])
  })

  it('moves between months with the arrows and the columns', async () => {
    renderTotals()
    await period('March 2026')
    fireEvent.click(screen.getByRole('button', { name: t('insights.period.previous') }))
    expect(await period('February 2026')).toBeInTheDocument()
    expect(within(totals()).getByText(t('insights.totals.netNone'))).toBeInTheDocument()
    expect(screen.getByText(t('insights.empty.period'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('insights.period.next') }))
    expect(screen.getByRole('button', { name: t('insights.period.next') })).toBeDisabled()

    const march = screen.getByRole('button', {
      name: t('insights.byMonth.column', { month: 'March 2026', amount: '$34.00' }),
    })
    expect(march).toHaveAttribute('aria-pressed', 'true')
    expect(march).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(march, { key: 'ArrowLeft' })
    const feb = screen.getByRole('button', { name: /^February 2026/ })
    expect(feb).toHaveFocus()
    fireEvent.keyDown(feb, { key: 'Home' })
    expect(screen.getByRole('button', { name: /^April 2025/ })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    fireEvent.click(feb)
    expect(await period('February 2026')).toBeInTheDocument()
  })

  it('adds up a year and all time, where the net is the balance', async () => {
    renderTotals()
    await period('March 2026')
    fireEvent.click(screen.getByRole('radio', { name: t('insights.period.all') }))
    expect(await period(t('insights.period.allTime'))).toBeInTheDocument()
    expect(within(totals()).getByText('$89.00')).toBeInTheDocument()
    expect(
      within(totals()).getByText(t('insights.totals.netDown', { amount: '$29.00' })),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: t('insights.period.year') }))
    expect(await period('2026')).toBeInTheDocument()
    expect(within(totals()).getByText('$212.00')).toBeInTheDocument()
  })

  it('switches every chart to what everyone spent, with a table view', async () => {
    renderTotals()
    await period('March 2026')
    fireEvent.click(screen.getByRole('radio', { name: t('insights.byMonth.spend') }))
    expect(
      screen.getByRole('button', {
        name: t('insights.byMonth.column', { month: 'March 2026', amount: '$102.00' }),
      }),
    ).toBeInTheDocument()
    const table = screen.getByRole('table', { name: t('insights.byMonth.title') })
    expect(within(table).getByRole('row', { name: 'March 2026 $102.00' })).toBeInTheDocument()
  })

  it('links to the group activity and the deleted items', async () => {
    renderTotals()
    await period('March 2026')
    expect(
      screen.getByRole('link', { name: new RegExp(t('insights.links.deleted')) }),
    ).toHaveAttribute('href', `/groups/${GROUP_ID}/deleted`)
    expect(
      screen.getByRole('link', { name: new RegExp(t('insights.links.activity')) }),
    ).toHaveAttribute('href', `/activity?groupId=${GROUP_ID}`)
  })

  it('invites a first expense when nothing was spent', async () => {
    renderTotals([])
    expect(await screen.findByText(t('insights.empty.title'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('empty.expenses.action') })).toHaveAttribute(
      'href',
      `/new/expense?groupId=${GROUP_ID}`,
    )
    expect(ME).toBeTruthy()
  })
})
