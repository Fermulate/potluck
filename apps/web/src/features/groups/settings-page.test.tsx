import type * as AuthModule from '@/lib/auth'
import { moneyKeys, plansKeys, type GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expense } from '@/features/expenses/test-utils'
import { group, groupTables, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, payloadOf, resetDb, rowsOf } from '@/test/supabase'
import { GroupSettingsPage } from './settings-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

const square = [
  member(VIEWER, 'Ava Chen', 'owner'),
  member('u-ben', 'Ben Ortiz', 'admin'),
  member('u-cleo', 'Cleo Park'),
]

function renderSettings(seeded: GroupDetail = group(), tables: Record<string, unknown[]> = {}) {
  resetDb({ tables: { ...groupTables(seeded), ...tables } }).respond('rpc:simplified_debts', {
    data: [],
  })
  return renderWithProviders(
    <>
      <GroupSettingsPage groupId="g-hike" />
      <Toaster label="Notifications" />
    </>,
    { path: '/groups/g-hike/settings' },
  )
}

/** The delete button once the group's debts have loaded and it can be pressed. */
async function deleteButton() {
  const button = await screen.findByRole('button', { name: t('groups.settings.delete') })
  await waitFor(() => expect(button).toBeEnabled())
  return button
}

function groupUpdates() {
  return db()
    .queries('groups')
    .map((call) => payloadOf(call, 'update'))
    .filter(Boolean)
}

describe('GroupSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })

  it('saves only the details that changed', async () => {
    renderSettings()
    const name = await screen.findByRole('textbox', { name: t('groups.create.nameLabel') })
    const save = screen.getByRole('button', { name: t('common.save') })
    expect(save).toBeDisabled()

    fireEvent.change(name, { target: { value: ' Summit crew ' } })
    fireEvent.click(screen.getByRole('radio', { name: t('groups.colors.plum') }))
    fireEvent.change(screen.getByRole('textbox', { name: t('groups.emojiPicker.custom') }), {
      target: { value: '🏔️' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: t('groups.create.currencyLabel') }), {
      target: { value: 'EUR' },
    })
    fireEvent.click(save)

    expect(await screen.findByText(t('groups.settings.saved'))).toBeInTheDocument()
    expect(groupUpdates()).toEqual([
      { name: 'Summit crew', emoji: '🏔️', color: 'plum', currency: 'EUR' },
    ])
    expect(rowsOf('groups')[0]).toMatchObject({ name: 'Summit crew', currency: 'EUR' })
  })

  it('toggles the house rules', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('switch', { name: t('groups.settings.simplifyDebts') }))
    await waitFor(() => expect(groupUpdates()).toEqual([{ simplify_debts: false }]))
    fireEvent.click(screen.getByRole('switch', { name: t('groups.settings.membersCanInvite') }))
    await waitFor(() =>
      expect(groupUpdates()).toEqual([{ simplify_debts: false }, { members_can_invite: false }]),
    )
  })

  it('archives the group with an undo', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: t('groups.settings.archive') }))
    expect(
      await screen.findByText(t('groups.settings.archived', { group: 'Hike crew' })),
    ).toBeInTheDocument()
    expect(groupUpdates()[0]).toEqual({ archived_at: expect.any(String) })

    fireEvent.click(screen.getByRole('button', { name: t('common.undo') }))
    await waitFor(() => expect(groupUpdates()[1]).toEqual({ archived_at: null }))
  })

  it('drops an archived group from the New expense and New plan pickers', async () => {
    const { queryClient } = renderSettings()
    queryClient.setQueryData(moneyKeys.myGroups(), [])
    queryClient.setQueryData(plansKeys.myGroups(), [])
    fireEvent.click(await screen.findByRole('button', { name: t('groups.settings.archive') }))
    await waitFor(() =>
      expect(queryClient.getQueryState(moneyKeys.myGroups())?.isInvalidated).toBe(true),
    )
    expect(queryClient.getQueryState(plansKeys.myGroups())?.isInvalidated).toBe(true)
  })

  it('brings an archived group back', async () => {
    renderSettings(group({ archived_at: '2026-10-01T00:00:00Z' }))
    fireEvent.click(await screen.findByRole('button', { name: t('groups.settings.unarchive') }))
    expect(
      await screen.findByText(t('groups.settings.unarchived', { group: 'Hike crew' })),
    ).toBeInTheDocument()
    expect(groupUpdates()).toEqual([{ archived_at: null }])
  })

  it('puts the switch back and explains when a change is refused', async () => {
    renderSettings()
    const simplify = await screen.findByRole('switch', {
      name: t('groups.settings.simplifyDebts'),
    })
    db().respond('from:groups', { error: { message: 'Server error' } })
    fireEvent.click(simplify)
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
    await waitFor(() => expect(simplify).toBeChecked())
  })

  it('only lets the owner delete once everyone is square', async () => {
    renderSettings()
    expect(await screen.findByRole('button', { name: t('groups.settings.delete') })).toBeDisabled()
    expect(screen.getByText(t('groups.settings.deleteBlocked'))).toBeInTheDocument()
  })

  it('keeps delete closed while debts run in a circle, even with every balance at zero', async () => {
    // Simplifying is off and one person paid for three: the others owe them, whatever the nets say.
    renderSettings(group({ members: square, simplify_debts: false }), {
      expenses: [expense({ group_id: 'g-hike' })],
      settlements: [],
    })
    await waitFor(() => expect(db().queries('expenses')).not.toHaveLength(0))
    expect(await screen.findByRole('button', { name: t('groups.settings.delete') })).toBeDisabled()
    expect(screen.getByText(t('groups.settings.deleteBlocked'))).toBeInTheDocument()
  })

  it('deletes a settled group after confirming and returns to the list', async () => {
    const { router } = renderSettings(group({ members: square }))
    fireEvent.click(await deleteButton())
    const dialog = await screen.findByRole('dialog', { name: t('groups.settings.delete') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.settings.delete') }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
    expect(db().rpcArgs('delete_group')).toEqual([{ group_id: 'g-hike' }])
  })

  it('undoes a delete from the toast', async () => {
    render(<Toaster label="Shell notifications" />)
    const { router } = renderSettings(group({ members: square }))
    fireEvent.click(await deleteButton())
    const dialog = await screen.findByRole('dialog', { name: t('groups.settings.delete') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.settings.delete') }))
    // The page goes back to the list; the toast lives on in the app shell.
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
    fireEvent.click((await screen.findAllByRole('button', { name: t('common.undo') }))[0]!)

    expect(
      await screen.findByText(t('groups.deleted.restored', { group: 'Hike crew' })),
    ).toBeInTheDocument()
    expect(db().rpcArgs('restore_group')).toEqual([{ group_id: 'g-hike' }])
  })

  it('says so when the undo comes too late', async () => {
    render(<Toaster label="Shell notifications" />)
    const { router } = renderSettings(group({ members: square }))
    db().respond('rpc:restore_group', { error: { message: 'group_not_found', code: 'PT404' } })
    fireEvent.click(await deleteButton())
    const dialog = await screen.findByRole('dialog', { name: t('groups.settings.delete') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.settings.delete') }))
    // The page goes back to the list; the toast lives on in the app shell.
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
    fireEvent.click((await screen.findAllByRole('button', { name: t('common.undo') }))[0]!)
    expect(await screen.findByText(t('errors.codes.group_not_found'))).toBeInTheDocument()
  })

  it('makes the group a trip with dates, and refuses a trip that ends first', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(t('groups.types.trip')) }))
    const starts = await screen.findByLabelText(t('groups.trip.starts'))
    fireEvent.change(starts, { target: { value: '2026-07-10' } })
    fireEvent.change(screen.getByLabelText(t('groups.trip.ends')), {
      target: { value: '2026-07-01' },
    })
    const save = screen.getByRole('button', { name: t('common.save') })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(t('groups.trip.ends')), {
      target: { value: '2026-07-14' },
    })
    fireEvent.click(save)
    await waitFor(() =>
      expect(groupUpdates()).toEqual([
        { type: 'trip', starts_on: '2026-07-10', ends_on: '2026-07-14' },
      ]),
    )
  })

  it('drops the dates when a trip becomes something else', async () => {
    renderSettings(group({ type: 'trip', starts_on: '2026-07-10', ends_on: '2026-07-14' }))
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(t('groups.types.home')) }))
    fireEvent.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(groupUpdates()).toEqual([{ type: 'home', starts_on: null, ends_on: null }]),
    )
  })

  it('uploads a cover photo, sets it, and removes the old file', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    renderSettings(group({ cover_path: 'g-hike/cover-old.webp' }))
    expect(
      await screen.findByRole('img', { name: t('groups.cover.alt', { group: 'Hike crew' }) }),
    ).toHaveAttribute('src', expect.stringContaining('g-hike/cover-old.webp'))
    const file = new File(['photo'], 'beach.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText(t('groups.cover.change')), {
      target: { files: [file] },
    })

    expect(await screen.findByText(t('groups.cover.saved'))).toBeInTheDocument()
    const [upload, remove] = db()
      .storageCalls('group-covers')
      .filter((c) => c.method !== 'getPublicUrl')
    expect(upload!.args[0]).toMatch(/^g-hike\/cover-[a-z0-9]+\.jpg$/)
    expect(groupUpdates()).toEqual([{ cover_path: upload!.args[0] }])
    expect(remove!.args[0]).toEqual(['g-hike/cover-old.webp'])
  })

  it('refuses files that are not photos or too big, and removes a cover', async () => {
    renderSettings(group({ cover_path: 'g-hike/cover-old.webp' }))
    const input = await screen.findByLabelText(t('groups.cover.change'))
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] },
    })
    expect(await screen.findByText(t('groups.cover.wrongType'))).toBeInTheDocument()
    const big = new File(['x'], 'a.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: 41 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [big] } })
    expect(await screen.findByText(t('groups.cover.tooBig'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('groups.cover.remove') }))
    expect(await screen.findByText(t('groups.cover.removed'))).toBeInTheDocument()
    expect(groupUpdates()).toEqual([{ cover_path: null }])
  })

  it('checks the size again after shrinking, and uploads nothing over 10 MB', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    renderSettings()
    // jsdom cannot shrink images, so the photo goes through as it is: 11 MB.
    const heavy = new File([new Uint8Array(11 * 1024 * 1024)], 'heavy.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText(t('groups.cover.add')), {
      target: { files: [heavy] },
    })
    expect(await screen.findByText(t('groups.cover.tooBig'))).toBeInTheDocument()
    expect(
      db()
        .storageCalls('group-covers')
        .filter((c) => c.method === 'upload'),
    ).toEqual([])
  })

  it('takes the uploaded file back and says why when the group refuses the cover', async () => {
    renderSettings()
    const input = await screen.findByLabelText(t('groups.cover.add'))
    db().respond('from:groups', { error: { message: 'group_archived', code: '23514' } })
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText(t('errors.codes.group_archived'))).toBeInTheDocument()
    const [upload, remove] = db()
      .storageCalls('group-covers')
      .filter((c) => c.method !== 'getPublicUrl')
    expect(upload!.method).toBe('upload')
    expect(remove!.method).toBe('remove')
    expect(remove!.args[0]).toEqual([upload!.args[0]])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('says when an upload fails', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    renderSettings()
    db().respond('storage:group-covers.upload', { error: { message: 'boom' } })
    fireEvent.change(await screen.findByLabelText(t('groups.cover.add')), {
      target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText(t('groups.cover.failed'))).toBeInTheDocument()
    expect(groupUpdates()).toEqual([])
  })

  it('explains when the server still sees an open balance and keeps the group', async () => {
    const { router } = renderSettings(group({ members: square }))
    db().respond('rpc:delete_group', { error: { message: 'group_has_balances', code: '23514' } })
    fireEvent.click(await deleteButton())
    const dialog = await screen.findByRole('dialog', { name: t('groups.settings.delete') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.settings.delete') }))

    expect(await screen.findByText(t('errors.codes.group_has_balances'))).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/groups/g-hike/settings')
  })

  it('is read only for plain members, who can only head off to leave', async () => {
    renderSettings(
      group({
        members: [
          member('u-ben', 'Ben Ortiz', 'owner'),
          member(VIEWER, 'Ava Chen', 'member', -500),
        ],
      }),
    )
    expect(await screen.findByText(t('groups.settings.readOnly'))).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: t('groups.create.nameLabel') }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: t('groups.settings.simplifyDebts') })).toBeDisabled()
    expect(screen.getByText(t('groups.settings.leaveBlocked'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('groups.settings.leave') })).toHaveAttribute(
      'href',
      '/groups/g-hike/members',
    )
    expect(
      screen.queryByRole('button', { name: t('groups.settings.delete') }),
    ).not.toBeInTheDocument()
  })

  it('lets a settled admin leave', async () => {
    renderSettings(
      group({
        members: [member('u-ben', 'Ben Ortiz', 'owner'), member(VIEWER, 'Ava Chen', 'admin')],
      }),
    )
    expect(
      await screen.findByText(t('groups.settings.leaveConfirm', { group: 'Hike crew' })),
    ).toBeInTheDocument()
  })
})
