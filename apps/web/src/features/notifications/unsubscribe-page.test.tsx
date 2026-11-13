import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { fireEvent, screen } from '@testing-library/react'
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

const actions = () =>
  db()
    .calls.filter((c) => c.kind === 'rpc' && c.name === 'email_unsubscribe')
    .map((c) => (c as { args: { action: string } }).args.action)

const answer = (category: string, subscribed: boolean) => ({
  data: { category, email: 'a***@example.com', subscribed },
})

function open(token: string | undefined) {
  return renderWithProviders(<UnsubscribePage token={token} />, { path: '/unsubscribe' })
}

describe('UnsubscribePage', () => {
  beforeEach(() => {
    signedIn = false
    resetDb()
  })

  it('opening the link changes nothing: it asks first, naming the account', async () => {
    db().respond('rpc:email_unsubscribe', answer('payments', true))
    open('u1.payments.sig')
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.askTitle') }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(t('unsubscribe.account', { email: 'a***@example.com' })),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        t('unsubscribe.askOne', {
          what: t('settings.notificationPrefs.categories.payments.about'),
        }),
      ),
    ).toBeInTheDocument()
    expect(actions()).toEqual(['preview'])
    expect(screen.getByRole('link', { name: t('unsubscribe.manage') })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })

  it('one tap unsubscribes, and the same page can undo it', async () => {
    db().respond(
      'rpc:email_unsubscribe',
      answer('all', true),
      answer('all', false),
      answer('all', true),
    )
    signedIn = true
    open('u1.all.sig')
    expect(await screen.findByText(t('unsubscribe.askAll'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('unsubscribe.confirm') }))
    expect(await screen.findByRole('heading', { name: t('unsubscribe.done') })).toBeInTheDocument()
    expect(screen.getByText(t('unsubscribe.doneAll'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('unsubscribe.manage') })).toHaveAttribute(
      'href',
      '/me',
    )
    fireEvent.click(screen.getByRole('button', { name: t('unsubscribe.undo') }))
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.undone') }),
    ).toBeInTheDocument()
    expect(actions()).toEqual(['preview', 'unsubscribe', 'undo'])
  })

  it('a link whose emails are already off says so and offers to send them again', async () => {
    db().respond('rpc:email_unsubscribe', answer('comments', false), answer('comments', true))
    open('u1.comments.sig')
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.alreadyTitle') }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('unsubscribe.resubscribe') }))
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.undone') }),
    ).toBeInTheDocument()
    expect(actions()).toEqual(['preview', 'undo'])
  })

  it('says a broken link is broken, and does nothing without a token', async () => {
    db().respond('rpc:email_unsubscribe', { error: { message: 'invalid_unsubscribe_link' } })
    const { unmount } = open('nope')
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.invalidTitle') }),
    ).toBeInTheDocument()
    unmount()

    resetDb()
    open(undefined)
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.invalidTitle') }),
    ).toBeInTheDocument()
    expect(actions()).toEqual([])
  })

  it('offers a retry when the network fails, and says so when a tap fails', async () => {
    db().respond(
      'rpc:email_unsubscribe',
      { error: { message: 'Failed to fetch' } },
      answer('plans', true),
      { error: { message: 'Failed to fetch' } },
    )
    open('u1.plans.sig')
    fireEvent.click(await screen.findByRole('button', { name: t('unsubscribe.retry') }))
    fireEvent.click(await screen.findByRole('button', { name: t('unsubscribe.confirm') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('unsubscribe.failed'))
  })
})
