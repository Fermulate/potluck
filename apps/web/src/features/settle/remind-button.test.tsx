import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { dayKey } from '@potluck/core'
import { RemindButton } from './remind-button'

const utcToday = () => dayKey(new Date(), 'UTC')

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'u-ava' }))

function renderButton() {
  return renderWithProviders(
    <>
      <RemindButton groupId="g-1" userId="u-ben" name="Ben" />
      <Toaster label="Notifications" />
    </>,
  )
}

describe('RemindButton', () => {
  beforeEach(() => resetDb({ tables: { debt_reminders: [] } }))

  it('sends a nudge and shows it was sent', async () => {
    db().respond('rpc:remind_debt', { data: { id: 'r1' } })
    renderButton()
    fireEvent.click(
      await screen.findByRole('button', { name: t('balances.remindLabel', { name: 'Ben' }) }),
    )
    expect(await screen.findByText(t('balances.remindSent', { name: 'Ben' }))).toBeInTheDocument()
    expect(db().rpcArgs('remind_debt')).toEqual([{ group_id: 'g-1', user_id: 'u-ben' }])
  })

  it('says when a reminder already went out today', async () => {
    resetDb({
      tables: {
        debt_reminders: [
          { id: 'r1', group_id: 'g-1', from_user: 'u-ava', to_user: 'u-ben', sent_on: utcToday() },
        ],
      },
    })
    db().respond('rpc:remind_debt', { error: { message: 'already_reminded' } })
    renderButton()
    const button = await screen.findByRole('button', {
      name: t('balances.remindLabel', { name: 'Ben' }),
    })
    await waitFor(() => expect(button).toHaveTextContent(t('balances.reminded')))
    fireEvent.click(button)
    expect(
      await screen.findByText(t('balances.alreadyReminded', { name: 'Ben' })),
    ).toBeInTheDocument()
  })

  it('reports other failures', async () => {
    db().respond('rpc:remind_debt', { error: { message: 'nothing_owed' } })
    renderButton()
    fireEvent.click(
      await screen.findByRole('button', { name: t('balances.remindLabel', { name: 'Ben' }) }),
    )
    expect(await screen.findByText(t('expenses.errors.nothing_owed'))).toBeInTheDocument()
  })
})
