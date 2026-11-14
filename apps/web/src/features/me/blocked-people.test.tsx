import type * as AuthModule from '@/lib/auth'
import { peopleKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { QueryClient } from '@tanstack/react-query'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { BlockedPeopleSection } from './blocked-people'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function renderSection(client?: QueryClient) {
  return renderWithProviders(
    <>
      <BlockedPeopleSection />
      <Toaster label="Notifications" />
    </>,
    { path: '/me', client },
  )
}

describe('BlockedPeopleSection', () => {
  beforeEach(() => resetDb())

  it('says when nobody is blocked', async () => {
    db().respond('rpc:my_blocks', { data: [] })
    renderSection()
    expect(await screen.findByText(t('settings.privacy.noneBlocked'))).toBeInTheDocument()
  })

  it('unblocks someone', async () => {
    db().respond(
      'rpc:my_blocks',
      {
        data: [{ user_id: 'u-dan', display_name: 'Dan Ross', avatar_path: null, blocked_at: 't' }],
      },
      { data: [] },
    )
    renderSection()
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('people.blocked.unblockName', { name: 'Dan Ross' }),
      }),
    )
    expect(
      await screen.findByText(t('people.blocked.unblocked', { name: 'Dan Ross' })),
    ).toBeInTheDocument()
    const [unblock] = db().queries('blocks')
    expect(unblock?.ops.map((op) => op.method)).toContain('delete')
  })

  it('forgets that you could not split with someone once they are unblocked', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
    })
    client.setQueryData(peopleKeys.canSplit('u-dan'), false)
    db().respond(
      'rpc:my_blocks',
      {
        data: [{ user_id: 'u-dan', display_name: 'Dan Ross', avatar_path: null, blocked_at: 't' }],
      },
      { data: [] },
    )
    renderSection(client)
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('people.blocked.unblockName', { name: 'Dan Ross' }),
      }),
    )
    await screen.findByText(t('people.blocked.unblocked', { name: 'Dan Ross' }))
    expect(client.getQueryState(peopleKeys.canSplit('u-dan'))?.isInvalidated).toBe(true)
  })

  it('explains a failed unblock', async () => {
    db()
      .respond('rpc:my_blocks', {
        data: [{ user_id: 'u-dan', display_name: 'Dan Ross', avatar_path: null, blocked_at: 't' }],
      })
      .respond('from:blocks', { error: { message: 'Server error' } })
    renderSection()
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('people.blocked.unblockName', { name: 'Dan Ross' }),
      }),
    )
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
  })
})
