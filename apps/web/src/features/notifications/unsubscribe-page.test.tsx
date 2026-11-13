import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { UnsubscribePage } from './unsubscribe-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
let signedIn = false
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useSession: () => (signedIn ? { user: { id: 'u-ava' } } : null),
}))

const rpcCalls = () => db().calls.filter((c) => c.kind === 'rpc' && c.name === 'email_unsubscribe')

describe('UnsubscribePage', () => {
  beforeEach(() => {
    signedIn = false
    resetDb()
  })

  it('unsubscribes on open and names what stopped', async () => {
    db().respond('rpc:email_unsubscribe', { data: 'payments' })
    renderWithProviders(<UnsubscribePage token="u1.payments.sig" />, { path: '/unsubscribe' })
    expect(await screen.findByRole('heading', { name: t('unsubscribe.done') })).toBeInTheDocument()
    expect(
      screen.getByText(
        t('unsubscribe.doneOne', {
          what: t('settings.notificationPrefs.categories.payments.about'),
        }),
      ),
    ).toBeInTheDocument()
    expect(rpcCalls()).toEqual([
      {
        kind: 'rpc',
        name: 'email_unsubscribe',
        args: { token: 'u1.payments.sig', subscribe: false },
      },
    ])
    expect(screen.getByRole('link', { name: t('unsubscribe.manage') })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })

  it('can undo it from the same page', async () => {
    db().respond('rpc:email_unsubscribe', { data: 'all' }, { data: 'all' })
    signedIn = true
    renderWithProviders(<UnsubscribePage token="u1.all.sig" />, { path: '/unsubscribe' })
    expect(await screen.findByText(t('unsubscribe.doneAll'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('unsubscribe.manage') })).toHaveAttribute(
      'href',
      '/me',
    )
    fireEvent.click(screen.getByRole('button', { name: t('unsubscribe.undo') }))
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.undone') }),
    ).toBeInTheDocument()
    expect(rpcCalls()[1]).toMatchObject({ args: { token: 'u1.all.sig', subscribe: true } })
    expect(screen.queryByRole('button', { name: t('unsubscribe.undo') })).toBeNull()
  })

  it('says a broken link is broken, and does nothing without a token', async () => {
    db().respond('rpc:email_unsubscribe', { error: { message: 'invalid_unsubscribe_link' } })
    const { unmount } = renderWithProviders(<UnsubscribePage token="nope" />, {
      path: '/unsubscribe',
    })
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.invalidTitle') }),
    ).toBeInTheDocument()
    unmount()

    resetDb()
    renderWithProviders(<UnsubscribePage token={undefined} />, { path: '/unsubscribe' })
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.invalidTitle') }),
    ).toBeInTheDocument()
    expect(rpcCalls()).toEqual([])
  })

  it('offers a retry when the network fails', async () => {
    db().respond(
      'rpc:email_unsubscribe',
      { error: { message: 'Failed to fetch' } },
      { data: 'comments' },
    )
    renderWithProviders(<UnsubscribePage token="u1.comments.sig" />, { path: '/unsubscribe' })
    fireEvent.click(await screen.findByRole('button', { name: t('unsubscribe.retry') }))
    await waitFor(() =>
      expect(
        screen.getByText(
          t('unsubscribe.doneOne', {
            what: t('settings.notificationPrefs.categories.comments.about'),
          }),
        ),
      ).toBeInTheDocument(),
    )
  })
})
