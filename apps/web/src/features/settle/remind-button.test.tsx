import { dayKey } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { RemindButton } from './remind-button'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'u-ava' }))

const utcToday = () => dayKey(new Date(), 'UTC')

function renderButton() {
  return renderWithProviders(
    <>
      <RemindButton groupId="g-1" userId="u-ben" name="Ben" />
      <Toaster label="Notifications" />
    </>,
  )
}

const remindButton = () =>
  screen.findByRole('button', { name: t('balances.remindLabel', { name: 'Ben' }) })

describe('RemindButton', () => {
  beforeEach(() => resetDb({ tables: { debt_reminders: [] } }))

  it('sends a nudge with an optional note', async () => {
    db().respond('rpc:remind_debt', { data: { id: 'r1' } })
    renderButton()
    fireEvent.click(await remindButton())
    const sheet = await screen.findByRole('dialog', {
      name: t('balances.remindTitle', { name: 'Ben' }),
    })
    fireEvent.change(within(sheet).getByRole('textbox', { name: t('balances.remindNote') }), {
      target: { value: 'Rent is due Friday' },
    })
    fireEvent.click(within(sheet).getByRole('button', { name: t('balances.remindSend') }))
    expect(await screen.findByText(t('balances.remindSent', { name: 'Ben' }))).toBeInTheDocument()
    expect(db().rpcArgs('remind_debt')).toEqual([
      { group_id: 'g-1', user_id: 'u-ben', note: 'Rent is due Friday' },
    ])
  })

  it('says a reminder already went out today without sending another', async () => {
    resetDb({
      tables: {
        debt_reminders: [
          { id: 'r1', group_id: 'g-1', from_user: 'u-ava', to_user: 'u-ben', sent_on: utcToday() },
        ],
      },
    })
    renderButton()
    const button = await remindButton()
    await waitFor(() => expect(button).toHaveTextContent(t('balances.reminded')))
    fireEvent.click(button)
    expect(
      await screen.findByText(t('balances.alreadyReminded', { name: 'Ben' })),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(db().rpcArgs('remind_debt')).toEqual([])
  })

  it('says so when the server already has one for today', async () => {
    db().respond('rpc:remind_debt', { error: { message: 'already_reminded' } })
    renderButton()
    fireEvent.click(await remindButton())
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: t('balances.remindSend') }))
    expect(
      await screen.findByText(t('balances.alreadyReminded', { name: 'Ben' })),
    ).toBeInTheDocument()
  })

  it('reports other failures', async () => {
    db().respond('rpc:remind_debt', { error: { message: 'nothing_owed' } })
    renderButton()
    fireEvent.click(await remindButton())
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: t('balances.remindSend') }))
    expect(await screen.findByText(t('expenses.errors.nothing_owed'))).toBeInTheDocument()
  })
})
