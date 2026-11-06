import { ACTIVITY_PAGE_SIZE } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { argsOf, db, emitChange, resetDb, subscriptions } from '@/test/supabase'
import { BEN, ME, seededClient } from '../expenses/test-utils'
import { ActivityFeed } from './activity-feed'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

const hike = { id: 'g-hike', name: 'Hike crew', emoji: '🥾', is_direct: false }
const direct = { id: 'g-ben', name: '', emoji: null, is_direct: true }

function activity(id: string, created_at: string, patch: object = {}) {
  return {
    id,
    group_id: 'g-hike',
    actor_id: BEN,
    verb: 'expense.created',
    subject_id: `x-${id}`,
    data: { description: 'Tacos', amount_cents: 4500, currency: 'USD' },
    created_at,
    actor: { id: BEN, display_name: 'Ben Okafor', avatar_path: null },
    group: hike,
    ...patch,
  }
}

function renderFeed(rows: Record<string, unknown>[]) {
  resetDb({ tables: { activity: rows, groups: [{ ...hike, group_members: [] }] } })
  return renderWithProviders(<ActivityFeed />, { path: '/activity', client: seededClient() })
}

describe('ActivityFeed', () => {
  beforeEach(() => vi.clearAllMocks())

  it('groups what happened by day, newest first, with links', async () => {
    renderFeed([
      activity('a1', '2026-11-04T18:00:00Z'),
      activity('a2', '2026-11-03T12:00:00Z', {
        verb: 'settlement.created',
        actor_id: ME,
        data: { from_user: ME, to_user: BEN, amount_cents: 2000, currency: 'USD' },
        group: direct,
      }),
      activity('a3', '2026-11-03T10:00:00Z', { verb: 'group.created', group: direct }),
    ])
    const tacos = await screen.findByRole('link', { name: /Ben added "Tacos"/ })
    expect(tacos).toHaveAttribute('href', '/expenses/x-a1')
    expect(within(tacos).getByText(/Hike crew/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /You paid Ben/ })).toHaveTextContent(
      t('activity.direct'),
    )
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2)
    // Opening a hidden one-to-one tab is not news.
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('loads older pages on request', async () => {
    const page = Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, i) =>
      activity(`p${i}`, new Date(Date.parse('2026-11-04T12:00:00Z') - i * 60_000).toISOString()),
    )
    renderFeed([
      ...page,
      activity('old', '2026-10-01T12:00:00Z', {
        data: { description: 'Firewood', amount_cents: 1000, currency: 'USD' },
      }),
    ])
    fireEvent.click(await screen.findByRole('button', { name: t('activity.loadMore') }))
    expect(await screen.findByRole('link', { name: /Firewood/ })).toBeInTheDocument()
    const [, second] = db().queries('activity')
    const last = page.at(-1)!
    expect(argsOf(second!, 'or')).toEqual([
      [
        `created_at.lt."${last.created_at}",and(created_at.eq."${last.created_at}",id.lt."${last.id}")`,
      ],
    ])
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: t('activity.loadMore') }),
      ).not.toBeInTheDocument(),
    )
  })

  it('suggests adding an expense when nothing has happened', async () => {
    renderFeed([])
    expect(await screen.findByText(t('empty.activity.title'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('empty.activity.action') })).toHaveAttribute(
      'href',
      '/new/expense',
    )
  })

  it('picks up new activity live', async () => {
    renderFeed([])
    await screen.findByText(t('empty.activity.title'))
    db().respond('from:activity', { data: [activity('a9', '2026-11-05T09:00:00Z')] })
    emitChange('activity')
    expect(await screen.findByRole('link', { name: /Ben added "Tacos"/ })).toBeInTheDocument()
  })

  it("listens only to the viewer's groups", async () => {
    renderFeed([])
    await waitFor(() =>
      expect(subscriptions()).toContainEqual({ table: 'activity', filter: 'group_id=in.(g-hike)' }),
    )
    expect(subscriptions().filter((s) => s.table === 'activity')).toHaveLength(1)
  })
})
