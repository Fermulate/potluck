import type * as AuthModule from '@/lib/auth'
import type { GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

function renderSettings(seeded: GroupDetail = group()) {
  resetDb({ tables: groupTables(seeded) })
  return renderWithProviders(
    <>
      <GroupSettingsPage groupId="g-hike" />
      <Toaster label="Notifications" />
    </>,
    { path: '/groups/g-hike/settings' },
  )
}

function groupUpdates() {
  return db()
    .queries('groups')
    .map((call) => payloadOf(call, 'update'))
    .filter(Boolean)
}

describe('GroupSettingsPage', () => {
  beforeEach(() => vi.clearAllMocks())

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

  it('deletes a settled group after confirming and returns to the list', async () => {
    const { router } = renderSettings(group({ members: square }))
    fireEvent.click(await screen.findByRole('button', { name: t('groups.settings.delete') }))
    const dialog = await screen.findByRole('dialog', { name: t('groups.settings.delete') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('groups.settings.delete') }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
    expect(rowsOf('groups')).toEqual([])
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
