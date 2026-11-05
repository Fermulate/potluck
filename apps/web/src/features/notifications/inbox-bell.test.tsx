import { meKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderInRouter } from '@/features/expenses/router-test-utils'
import { ME, seededClient } from '@/features/expenses/test-utils'
import { InboxBell } from './inbox-bell'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

describe('InboxBell', () => {
  it('opens the inbox and says how much is unread', async () => {
    renderInRouter(
      <InboxBell />,
      seededClient((c) => c.setQueryData(meKeys.unread(ME), 3)),
    )
    const bell = await screen.findByRole('link', {
      name: `${t('nav.notifications')} (${t('notifications.unread', { count: 3 })})`,
    })
    expect(bell).toHaveAttribute('href', '/notifications')
    expect(bell).toHaveTextContent('3')
  })

  it('is just the bell when everything is read', async () => {
    renderInRouter(
      <InboxBell />,
      seededClient((c) => c.setQueryData(meKeys.unread(ME), 0)),
    )
    expect(await screen.findByRole('link', { name: t('nav.notifications') })).toHaveAttribute(
      'href',
      '/notifications',
    )
  })
})
