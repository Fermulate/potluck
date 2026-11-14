import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { group, groupTables, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { resetDb } from '@/test/supabase'
import { HomeStarters } from './home-starters'
import { useGroup } from './use-groups'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

/** Shows the group's name once the same query the starters read has its answer. */
function Loaded() {
  const { data } = useGroup('g-hike')
  return data ? <p>{data.name}</p> : null
}

function renderStarters(type: 'home' | 'trip', archived_at: string | null = null) {
  resetDb({ tables: groupTables(group({ type, archived_at })) })
  return renderWithProviders(
    <>
      <Loaded />
      <HomeStarters groupId="g-hike" />
    </>,
    { path: '/groups/g-hike' },
  )
}

describe('HomeStarters', () => {
  it('offers a home its monthly rent and utilities as repeating expenses', async () => {
    renderStarters('home')
    expect(
      await screen.findByRole('heading', { name: t('groups.starters.title') }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('groups.starters.rent') })).toHaveAttribute(
      'href',
      '/new/expense?groupId=g-hike&preset=rent',
    )
    expect(screen.getByRole('link', { name: t('groups.starters.utilities') })).toHaveAttribute(
      'href',
      '/new/expense?groupId=g-hike&preset=utilities',
    )
  })

  it('stays out of the way for other groups and archived homes', async () => {
    const { unmount } = renderStarters('trip')
    await screen.findByText('Hike crew')
    expect(screen.queryByRole('heading', { name: t('groups.starters.title') })).toBeNull()
    unmount()
    renderStarters('home', '2026-10-01T00:00:00Z')
    await screen.findByText('Hike crew')
    expect(screen.queryByRole('heading', { name: t('groups.starters.title') })).toBeNull()
  })
})
