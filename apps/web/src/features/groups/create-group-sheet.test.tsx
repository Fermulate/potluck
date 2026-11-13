import type * as AuthModule from '@/lib/auth'
import { moneyKeys, plansKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { CreateGroupSheet } from './create-group-sheet'
import { GROUP_EMOJIS } from './group-emojis'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function renderSheet() {
  const onOpenChange = vi.fn()
  const view = renderWithProviders(
    <>
      <CreateGroupSheet open onOpenChange={onOpenChange} />
      <Toaster label="Notifications" />
    </>,
    { path: '/groups' },
  )
  return { ...view, onOpenChange }
}

describe('CreateGroupSheet', () => {
  beforeEach(() => {
    resetDb({
      tables: { profiles: [{ id: VIEWER, display_name: 'Ava', default_currency: 'EUR' }] },
    })
  })

  it('creates the group in the default currency and opens its members page', async () => {
    db().respond('rpc:create_group', { data: { id: 'g-taco', name: 'Taco Tuesdays' } })
    const { router, onOpenChange } = renderSheet()
    const dialog = await screen.findByRole('dialog', { name: t('groups.create.title') })
    const submit = within(dialog).getByRole('button', { name: t('groups.create.submit') })
    expect(submit).toBeDisabled()
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: t('groups.create.currencyLabel') }),
      ).toHaveValue('EUR'),
    )

    fireEvent.change(within(dialog).getByRole('textbox', { name: t('groups.create.nameLabel') }), {
      target: { value: '  Taco Tuesdays ' },
    })
    fireEvent.click(within(dialog).getByRole('radio', { name: GROUP_EMOJIS[2] }))
    fireEvent.click(within(dialog).getByRole('radio', { name: t('groups.colors.sea') }))
    fireEvent.click(submit)

    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-taco/members'))
    expect(db().rpcArgs('create_group')).toEqual([
      { name: 'Taco Tuesdays', emoji: GROUP_EMOJIS[2], color: 'sea', currency: 'EUR' },
    ])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('refreshes the New expense and New plan group pickers', async () => {
    db().respond('rpc:create_group', { data: { id: 'g-ski', name: 'Ski trip' } })
    const { router, queryClient } = renderSheet()
    queryClient.setQueryData(moneyKeys.myGroups(), [])
    queryClient.setQueryData(plansKeys.myGroups(), [])
    const dialog = await screen.findByRole('dialog', { name: t('groups.create.title') })
    fireEvent.change(within(dialog).getByRole('textbox', { name: t('groups.create.nameLabel') }), {
      target: { value: 'Ski trip' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.create.submit') }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-ski/members'))
    expect(queryClient.getQueryState(moneyKeys.myGroups())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(plansKeys.myGroups())?.isInvalidated).toBe(true)
  })

  it('keeps the sheet open and explains when creating fails', async () => {
    db().respond('rpc:create_group', { error: { message: 'Server error' } })
    const { router, onOpenChange } = renderSheet()
    const dialog = await screen.findByRole('dialog', { name: t('groups.create.title') })
    fireEvent.change(within(dialog).getByRole('textbox', { name: t('groups.create.nameLabel') }), {
      target: { value: 'Flat 4B' },
    })
    fireEvent.change(
      within(dialog).getByRole('combobox', { name: t('groups.create.currencyLabel') }),
      {
        target: { value: 'GBP' },
      },
    )
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.create.submit') }))

    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
    expect(db().rpcArgs('create_group')[0]).toMatchObject({ name: 'Flat 4B', currency: 'GBP' })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/groups')
  })

  it('adds people not on Potluck yet once the group exists', async () => {
    db()
      .respond('rpc:create_group', { data: { id: 'g-taco', name: 'Taco Tuesdays' } })
      .respond('rpc:add_placeholder_member', { data: 'p-1' })
    renderSheet()
    const dialog = await screen.findByRole('dialog', { name: t('groups.create.title') })
    fireEvent.change(within(dialog).getByRole('textbox', { name: t('groups.create.nameLabel') }), {
      target: { value: 'Taco Tuesdays' },
    })
    const seat = within(dialog).getByRole('textbox', { name: t('people.createGroup.label') })
    fireEvent.change(seat, { target: { value: 'Sam' } })
    fireEvent.click(screen.getByRole('button', { name: t('people.createGroup.add') }))
    fireEvent.change(seat, { target: { value: 'Pat' } })
    fireEvent.keyDown(seat, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Sam`) }))
    fireEvent.change(seat, { target: { value: 'Jo' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.create.submit') }))
    await waitFor(() =>
      expect(db().rpcArgs('add_placeholder_member')).toEqual([
        { group_id: 'g-taco', display_name: 'Pat' },
        { group_id: 'g-taco', display_name: 'Jo' },
      ]),
    )
  })
})
