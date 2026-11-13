import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { group, groupTables, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { resetDb } from '@/test/supabase'
import { HomeStarters } from './home-starters'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function renderStarters(type: 'home' | 'trip', archived_at: string | null = null) {
  resetDb({ tables: groupTables(group({ type, archived_at })) })
  return renderWithProviders(
    <>
      <p>loaded</p>
      <HomeStarters groupId="g-hike" />
    </>,
    { path: '/groups/g-hike' },
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

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
    await screen.findByText('loaded')
    await settle()
    expect(screen.queryByRole('heading', { name: t('groups.starters.title') })).toBeNull()
    unmount()
    renderStarters('home', '2026-10-01T00:00:00Z')
    await screen.findByText('loaded')
    await settle()
    expect(screen.queryByRole('heading', { name: t('groups.starters.title') })).toBeNull()
  })
})
