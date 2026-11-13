import type * as AuthModule from '@/lib/auth'
import { moneyKeys, plansKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster, toast } from '@potluck/ui'
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
    db().respond('rpc:create_group_v2', { data: { id: 'g-taco', name: 'Taco Tuesdays' } })
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
    expect(db().rpcArgs('create_group_v2')).toEqual([
      {
        name: 'Taco Tuesdays',
        emoji: GROUP_EMOJIS[2],
        color: 'sea',
        currency: 'EUR',
        type: 'other',
      },
    ])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('refreshes the New expense and New plan group pickers', async () => {
    db().respond('rpc:create_group_v2', { data: { id: 'g-ski', name: 'Ski trip' } })
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

  it('makes a trip with dates, its emoji following the type until one is picked', async () => {
    db().respond('rpc:create_group_v2', { data: { id: 'g-lis', name: 'Lisbon' } })
    const { router } = renderSheet()
    const dialog = await screen.findByRole('dialog', { name: t('groups.create.title') })
    fireEvent.change(within(dialog).getByRole('textbox', { name: t('groups.create.nameLabel') }), {
      target: { value: 'Lisbon' },
    })
    expect(within(dialog).queryByLabelText(t('groups.trip.starts'))).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(t('groups.types.trip')) }))
    const starts = await within(dialog).findByLabelText(t('groups.trip.starts'))
    const ends = within(dialog).getByLabelText(t('groups.trip.ends'))
    fireEvent.change(starts, { target: { value: '2026-06-10' } })
    fireEvent.change(ends, { target: { value: '2026-06-03' } })
    const submit = within(dialog).getByRole('button', { name: t('groups.create.submit') })
    expect(within(dialog).getByText(t('groups.trip.endBeforeStart'))).toBeInTheDocument()
    expect(submit).toBeDisabled()
    fireEvent.change(ends, { target: { value: '2026-06-14' } })
    fireEvent.click(submit)

    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-lis/members'))
    expect(db().rpcArgs('create_group_v2')[0]).toMatchObject({
      name: 'Lisbon',
      emoji: '🧳',
      type: 'trip',
      starts_on: '2026-06-10',
      ends_on: '2026-06-14',
    })
  })

  it('keeps a picked emoji when the type changes, and drops dates off a trip', async () => {
    db().respond('rpc:create_group_v2', { data: { id: 'g-home', name: 'Flat' } })
    renderSheet()
    const dialog = await screen.findByRole('dialog', { name: t('groups.create.title') })
    fireEvent.change(within(dialog).getByRole('textbox', { name: t('groups.create.nameLabel') }), {
      target: { value: 'Flat' },
    })
    fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(t('groups.types.trip')) }))
    fireEvent.change(await within(dialog).findByLabelText(t('groups.trip.starts')), {
      target: { value: '2026-06-10' },
    })
    fireEvent.click(within(dialog).getByRole('radio', { name: GROUP_EMOJIS[3] }))
    fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(t('groups.types.home')) }))
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.create.submit') }))

    await waitFor(() => expect(db().rpcArgs('create_group_v2')).toHaveLength(1))
    expect(db().rpcArgs('create_group_v2')[0]).toEqual({
      name: 'Flat',
      emoji: GROUP_EMOJIS[3],
      color: 'saffron',
      currency: 'EUR',
      type: 'home',
    })
  })

  it('keeps the sheet open and explains when creating fails', async () => {
    db().respond('rpc:create_group_v2', { error: { message: 'Server error' } })
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
    expect(db().rpcArgs('create_group_v2')[0]).toMatchObject({ name: 'Flat 4B', currency: 'GBP' })
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

  it('opens the new group once and names who could not be added', async () => {
    db()
      .respond('rpc:create_group', { data: { id: 'g-taco', name: 'Taco Tuesdays' } })
      .respond('rpc:add_placeholder_member', { error: { message: 'too_many_invites' } })
    const failed = vi.spyOn(toast, 'error')
    const { router, onOpenChange } = renderSheet()
    const dialog = await screen.findByRole('dialog', { name: t('groups.create.title') })
    fireEvent.change(within(dialog).getByRole('textbox', { name: t('groups.create.nameLabel') }), {
      target: { value: 'Taco Tuesdays' },
    })
    const seat = within(dialog).getByRole('textbox', { name: t('people.createGroup.label') })
    fireEvent.change(seat, { target: { value: 'Pat' } })
    fireEvent.keyDown(seat, { key: 'Enter' })
    fireEvent.change(seat, { target: { value: 'Jo' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.create.submit') }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-taco/members'))
    expect(failed).toHaveBeenCalledWith(t('people.createGroup.notAdded', { names: 'Pat and Jo' }))
    failed.mockRestore()
    expect(db().rpcArgs('create_group')).toHaveLength(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
