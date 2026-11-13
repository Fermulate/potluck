import { groupKeys, SEARCH_PAGE_SIZE } from '@potluck/api'
import { t } from '@potluck/i18n'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { BEN, GROUP_ID, ME, members, seededClient } from '../expenses/test-utils'
import { SearchScreen } from './search-screen'
import type { MoneySearch } from './search-params'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

const ROAD = '20000000-0000-4000-8000-000000000002'

const hit = (patch: object) => ({
  kind: 'expense',
  id: 'e1',
  group_id: GROUP_ID,
  day: '2026-03-05',
  at: '2026-03-05T18:00:00Z',
  description: 'Taco night',
  category: 'food',
  amount_cents: 9000,
  currency: 'USD',
  group_currency: 'USD',
  group_amount_cents: 9000,
  paid_by: ME,
  to_user: null,
  created_by: ME,
  my_paid_cents: 9000,
  my_share_cents: 3000,
  deleted_at: null,
  matched: 'description',
  snippet: null,
  ...patch,
})

const groupRow = (id: string, name: string, emoji: string) => ({
  id,
  name,
  emoji,
  color: null,
  currency: 'USD',
  is_direct: false,
  archived_at: null,
  members: members.map((m) => ({ ...m, joined_at: '2026-01-01', net_cents: 0 })),
  my_role: 'member',
  my_net_cents: 0,
})

function renderSearch(search: MoneySearch, rows: object[], ...later: object[][]) {
  resetDb().respond('rpc:search_money', { data: rows }, ...later.map((data) => ({ data })))
  const client = seededClient((c) =>
    c.setQueryData(groupKeys.list(ME), [
      groupRow(GROUP_ID, 'Hike crew', '🥾'),
      groupRow(ROAD, 'Road trip', '🚐'),
    ]),
  )
  return renderWithProviders(<SearchScreen search={search} />, { path: '/search', client })
}

describe('SearchScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('waits for a query or a filter before searching', async () => {
    renderSearch({}, [])
    expect(await screen.findByText(t('search.idleTitle'))).toBeInTheDocument()
    expect(db().rpcArgs('search_money')).toEqual([])
    expect(screen.getByRole('searchbox', { name: t('search.label') })).toHaveFocus()
  })

  it('groups results by group, with why they matched', async () => {
    renderSearch({ q: 'taco' }, [
      hit({}),
      hit({
        id: 'e2',
        group_id: ROAD,
        description: 'Fuel',
        paid_by: BEN,
        my_paid_cents: 0,
        my_share_cents: 1200,
        matched: 'comment',
        snippet: 'after the taco truck',
      }),
      hit({
        kind: 'payment',
        id: 's1',
        description: 'Venmo for tacos',
        category: null,
        amount_cents: 3000,
        paid_by: BEN,
        to_user: ME,
        my_paid_cents: null,
        my_share_cents: null,
        matched: 'notes',
      }),
    ])
    const hike = await screen.findByRole('region', {
      name: t('search.inGroup', { count: 2, group: 'Hike crew' }),
    })
    expect(within(hike).getByRole('link', { name: /Taco night/ })).toHaveAttribute(
      'href',
      '/expenses/e1',
    )
    expect(within(hike).getByText(t('expenses.youLentLabel'))).toBeInTheDocument()
    expect(within(hike).getByText('Ben paid you')).toBeInTheDocument()
    const road = screen.getByRole('region', {
      name: t('search.inGroup', { count: 1, group: 'Road trip' }),
    })
    const marked = within(road).getByText('taco', { selector: 'mark' })
    expect(marked.parentElement).toHaveTextContent(
      t('search.matched.comment', { text: 'after the taco truck' }),
    )
    expect(within(road).getByText(t('expenses.youBorrowedLabel'))).toBeInTheDocument()
    expect(screen.getByText(t('search.results', { count: 3 }))).toBeInTheDocument()
    expect(db().rpcArgs('search_money')).toEqual([{ max_rows: SEARCH_PAGE_SIZE, query: 'taco' }])
  })

  it('says when nothing matches and clears the search', async () => {
    const { router } = renderSearch({ q: 'zzz' }, [])
    expect(await screen.findByText(t('empty.search.title'))).toBeInTheDocument()
    // The empty state's button (the field has its own clear button too).
    fireEvent.click(screen.getAllByRole('button', { name: t('empty.search.action') }).at(-1)!)
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('puts the typed query in the address once typing settles', async () => {
    const { router } = renderSearch({}, [])
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'rent' } })
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'rent' }))
  })

  it('filters from the sheet and shows each filter as a removable chip', async () => {
    const { router } = renderSearch({ q: 'taco', person: BEN, cats: 'food' }, [hit({})])
    await screen.findByRole('link', { name: /Taco night/ })
    expect(db().rpcArgs('search_money')[0]).toMatchObject({
      person: BEN,
      categories: ['food'],
    })
    const chips = screen.getByRole('list', { name: t('filters.title') })
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Ben', t('categories.food')])
    fireEvent.click(screen.getByRole('button', { name: t('filters.remove', { filter: 'Ben' }) }))
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('person'))

    fireEvent.click(screen.getByRole('button', { name: t('filters.openActive', { count: 2 }) }))
    const sheet = await screen.findByRole('dialog', { name: t('filters.title') })
    fireEvent.click(within(sheet).getByRole('button', { name: t('filters.lastMonth') }))
    await waitFor(() => expect(router.state.location.search).toHaveProperty('from'))
    fireEvent.click(within(sheet).getByRole('radio', { name: t('filters.payments') }))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ kind: 'payment' }))
    expect(router.state.location.search).not.toHaveProperty('cats')
  })

  it('says so when search fails, or when offline, instead of loading forever', async () => {
    resetDb().respond('rpc:search_money', { error: { message: 'invalid_query' } })
    const { unmount } = renderWithProviders(<SearchScreen search={{ q: 'x' }} />, {
      path: '/search',
      client: seededClient(),
    })
    expect(await screen.findByText(t('errors.codes.invalid_query'))).toBeInTheDocument()
    unmount()

    onlineManager.setOnline(false)
    try {
      resetDb().respond('rpc:search_money', { data: [] })
      renderWithProviders(<SearchScreen search={{ q: 'y' }} />, {
        path: '/search',
        client: seededClient(),
      })
      expect(await screen.findByText(t('errors.network'))).toBeInTheDocument()
      expect(screen.getByRole('button', { name: t('common.retry') })).toBeInTheDocument()
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it('centers a long comment on the words that matched, and opens payments in their group', async () => {
    const long =
      'We stopped at the market for supplies on the way up, and much later somebody remembered ' +
      'that the taco truck by the bridge takes cards now, which saved the evening for everyone.'
    renderSearch({ q: 'taco truck' }, [
      hit({ matched: 'comment', snippet: long }),
      hit({
        kind: 'payment',
        id: 's9',
        description: null,
        category: null,
        paid_by: BEN,
        to_user: ME,
        my_paid_cents: null,
        my_share_cents: null,
        matched: 'person',
        snippet: 'Ben',
      }),
    ])
    const mark = await screen.findByText('taco truck', { selector: 'mark' })
    const line = mark.parentElement!.textContent!
    expect(line).toMatch(/^Comment: "\u2026/)
    expect(line).toMatch(/taco truck by the bridge/)
    // Short enough to stay in view in two lines on a phone.
    expect(line.length).toBeLessThan(80)
    expect(screen.getByRole('link', { name: /Ben paid you/ })).toHaveAttribute(
      'href',
      '/payments/s9',
    )
  })

  it('names every payer, and says when money came back', async () => {
    renderSearch({ q: 'rent' }, [
      hit({ id: 'r1', description: 'Rent', payers: [BEN, ME], paid_by: BEN }),
      hit({ id: 'r2', description: 'Rent refund', payers: [BEN], paid_by: BEN, is_refund: true }),
    ])
    expect(await screen.findByText(/^You and Ben paid \$90\.00, /)).toBeInTheDocument()
    expect(screen.getByText(/^Ben got back \$90\.00, /)).toBeInTheDocument()
  })

  it('loads more pages', async () => {
    const page = Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) =>
      hit({ id: `p${i}`, description: `Pizza ${i}` }),
    )
    renderSearch({ q: 'pizza' }, page, [hit({ id: 'last', description: 'Pizza last' })])
    expect(
      await screen.findByText(t('search.resultsMore', { count: SEARCH_PAGE_SIZE })),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('search.loadMore') }))
    expect(await screen.findByRole('link', { name: /Pizza last/ })).toBeInTheDocument()
    expect(db().rpcArgs('search_money')[1]).toMatchObject({ before_id: `p${SEARCH_PAGE_SIZE - 1}` })
  })
})
