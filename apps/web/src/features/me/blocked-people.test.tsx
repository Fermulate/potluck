import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
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

function renderSection() {
  return renderWithProviders(
    <>
      <BlockedPeopleSection />
      <Toaster label="Notifications" />
    </>,
    { path: '/me' },
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
