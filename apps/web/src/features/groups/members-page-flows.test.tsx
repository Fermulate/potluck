import type * as AuthModule from '@/lib/auth'
import type { GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, groupTables, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { MembersPage } from './members-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function renderMembers(g: GroupDetail = group()) {
  resetDb({ tables: { ...groupTables(g), group_invites: [] } })
  return renderWithProviders(
    <>
      <MembersPage groupId="g-hike" />
      <Toaster label="Notifications" />
    </>,
    { path: '/groups/g-hike/members' },
  )
}

async function pickAction(name: string, action: RegExp) {
  const row = (await screen.findByText(name)).closest('li')!
  fireEvent.click(within(row).getByRole('button', { name: `Actions for ${name}` }))
  fireEvent.click(await screen.findByRole('button', { name: action }))
}

async function confirm(title: string, button: string) {
  const dialog = await screen.findByRole('dialog', { name: title })
  fireEvent.click(within(dialog).getByRole('button', { name: button }))
}

describe('MembersPage actions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('makes someone an admin', async () => {
    renderMembers()
    await pickAction('Cleo Park', /^Make admin/)
    await confirm(t('members.makeAdmin'), t('common.confirm'))
    expect(
      await screen.findByText(t('members.roleChanged', { name: 'Cleo Park', role: 'admin' })),
    ).toBeInTheDocument()
    expect(db().rpcArgs('set_member_role')).toEqual([
      { group_id: 'g-hike', user_id: 'u-cleo', role: 'admin' },
    ])
  })

  it('hands ownership over', async () => {
    renderMembers()
    await pickAction('Ben Ortiz', /^Make owner/)
    await confirm(t('groups.settings.transfer'), t('members.makeOwner'))
    expect(
      await screen.findByText(t('members.transferred', { name: 'Ben Ortiz' })),
    ).toBeInTheDocument()
    expect(db().rpcArgs('transfer_ownership')).toEqual([{ group_id: 'g-hike', user_id: 'u-ben' }])
  })

  it('explains a refused change', async () => {
    renderMembers()
    db().respond('rpc:set_member_role', { error: { message: 'Server error' } })
    await pickAction('Cleo Park', /^Make admin/)
    await confirm(t('members.makeAdmin'), t('common.confirm'))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
  })

  it('lets a settled member leave and returns to the group list', async () => {
    const { router } = renderMembers(
      group({ members: [member('u-ben', 'Ben Ortiz', 'owner'), member(VIEWER, 'Ava Chen')] }),
    )
    fireEvent.click(await screen.findByRole('button', { name: t('members.leave') }))
    await confirm(t('groups.settings.leave'), t('members.leave'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
    expect(db().rpcArgs('leave_group')).toEqual([{ group_id: 'g-hike' }])
  })

  it('tells the owner to hand over before leaving', async () => {
    renderMembers(
      group({ members: [member(VIEWER, 'Ava Chen', 'owner'), member('u-ben', 'Ben Ortiz')] }),
    )
    expect(await screen.findByRole('button', { name: t('members.leave') })).toBeDisabled()
    expect(screen.getByText(t('groups.settings.ownerCannotLeave'))).toBeInTheDocument()
  })

  it('opens the invite sheet', async () => {
    renderMembers()
    fireEvent.click(await screen.findByRole('button', { name: t('members.invite') }))
    expect(await screen.findByRole('dialog', { name: t('invites.title') })).toBeInTheDocument()
  })
})
