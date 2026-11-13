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
import { AddPlaceholderSheet } from './placeholders'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

const sam = { ...member('p-sam', 'Sam Lee', 'member', -700), is_placeholder: true }
const pat = { ...member('p-pat', 'Pat Kim'), is_placeholder: true }

function seat(profile_id: string, extra: Record<string, unknown> = {}) {
  return {
    profile_id,
    group_id: 'g-hike',
    email_hint: null,
    created_by: VIEWER,
    invited_at: null,
    reminded_at: null,
    ...extra,
  }
}

function renderMembers(g: GroupDetail = group({ members: [...group().members, sam, pat] })) {
  resetDb({
    tables: {
      ...groupTables(g),
      placeholders: [
        seat('p-sam', { email_hint: 's***@example.com', invited_at: '2026-11-10T00:00:00Z' }),
        seat('p-pat'),
      ],
      group_invites: [
        {
          id: 'i1',
          group_id: 'g-hike',
          code: 'sam-seat-123',
          placeholder_id: 'p-sam',
          revoked_at: null,
          created_at: '2026-11-10',
        },
      ],
    },
  })
  return renderWithProviders(
    <>
      <MembersPage groupId="g-hike" />
      <Toaster label="Notifications" />
    </>,
    { path: '/groups/g-hike/members' },
  )
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest('li')!

async function openMenu(name: string) {
  fireEvent.click(within(await rowOf(name)).getByRole('button', { name: `Actions for ${name}` }))
  return screen.findByRole('dialog', { name })
}

describe('MembersPage with people not on Potluck yet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks them and says where their invite goes', async () => {
    renderMembers()
    const row = await rowOf('Sam Lee')
    expect(within(row).getByText(t('people.placeholder.badge'))).toBeInTheDocument()
    expect(
      within(row).getByText(t('people.placeholder.waitingFor', { email: 's***@example.com' })),
    ).toBeInTheDocument()
    expect(
      within(await rowOf('Pat Kim')).getByText(t('people.placeholder.noEmail')),
    ).toBeInTheDocument()
  })

  it('adds someone by name and email', async () => {
    renderMembers()
    db().respond('rpc:add_placeholder_member', { data: 'p-new' })
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(t('people.placeholder.add')) }),
    )
    const sheet = await screen.findByRole('dialog', { name: t('people.placeholder.addTitle') })
    fireEvent.change(within(sheet).getByLabelText(t('people.placeholder.nameLabel')), {
      target: { value: ' Jo ' },
    })
    fireEvent.change(within(sheet).getByLabelText(t('people.placeholder.emailLabel')), {
      target: { value: 'Jo@Example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('people.placeholder.submit') }))
    expect(
      await screen.findByText(t('people.placeholder.addedInvited', { name: 'Jo' })),
    ).toBeInTheDocument()
    expect(db().rpcArgs('add_placeholder_member')).toEqual([
      { group_id: 'g-hike', display_name: 'Jo', email: 'jo@example.com' },
    ])
  })

  it('refuses an email that does not look right before asking the server', async () => {
    renderMembers()
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(t('people.placeholder.add')) }),
    )
    const sheet = await screen.findByRole('dialog', { name: t('people.placeholder.addTitle') })
    fireEvent.change(within(sheet).getByLabelText(t('people.placeholder.nameLabel')), {
      target: { value: 'Jo' },
    })
    fireEvent.change(within(sheet).getByLabelText(t('people.placeholder.emailLabel')), {
      target: { value: 'not an email' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('people.placeholder.submit') }))
    expect(await within(sheet).findByText(t('errors.validation.invalidEmail'))).toBeInTheDocument()
    expect(db().rpcArgs('add_placeholder_member')).toEqual([])
  })

  it('sends the one reminder', async () => {
    renderMembers()
    const menu = await openMenu('Sam Lee')
    fireEvent.click(
      within(menu).getByRole('button', { name: new RegExp(t('people.placeholder.remind')) }),
    )
    expect(await screen.findByText(t('people.placeholder.reminded'))).toBeInTheDocument()
    expect(db().rpcArgs('remind_placeholder')).toEqual([{ user_id: 'p-sam' }])
  })

  it('shares their claim link', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderMembers()
    const menu = await openMenu('Sam Lee')
    fireEvent.click(within(menu).getByRole('button', { name: t('people.placeholder.shareLink') }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/join\/sam-seat-123$/)),
    )
    expect(
      await screen.findByText(t('people.placeholder.linkCopied', { name: 'Sam Lee' })),
    ).toBeInTheDocument()
  })

  it('renames them', async () => {
    renderMembers()
    const menu = await openMenu('Pat Kim')
    fireEvent.click(within(menu).getByRole('button', { name: t('people.placeholder.edit') }))
    const sheet = await screen.findByRole('dialog', {
      name: t('people.placeholder.editTitle', { name: 'Pat Kim' }),
    })
    fireEvent.change(within(sheet).getByLabelText(t('people.placeholder.nameLabel')), {
      target: { value: 'Pat Okafor' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('people.placeholder.save') }))
    expect(await screen.findByText(t('people.placeholder.saved'))).toBeInTheDocument()
    expect(db().rpcArgs('update_placeholder')).toEqual([
      { user_id: 'p-pat', display_name: 'Pat Okafor' },
    ])
  })

  it('removes a settled one, and not one with a balance', async () => {
    renderMembers()
    let menu = await openMenu('Sam Lee')
    expect(
      within(menu).getByRole('button', {
        name: new RegExp(t('people.placeholder.remove', { name: 'Sam Lee' })),
      }),
    ).toBeDisabled()
    fireEvent.keyDown(menu, { key: 'Escape' })

    menu = await openMenu('Pat Kim')
    fireEvent.click(
      within(menu).getByRole('button', {
        name: t('people.placeholder.remove', { name: 'Pat Kim' }),
      }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: t('people.placeholder.remove', { name: 'Pat Kim' }),
    })
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.remove') }))
    expect(
      await screen.findByText(t('people.placeholder.removed', { name: 'Pat Kim' })),
    ).toBeInTheDocument()
    expect(db().rpcArgs('remove_placeholder')).toEqual([{ user_id: 'p-pat' }])
  })

  it('offers no add row in an archived group', async () => {
    renderMembers(
      group({ members: [...group().members, sam], archived_at: '2026-11-01T00:00:00Z' }),
    )
    await rowOf('Sam Lee')
    expect(
      screen.queryByRole('button', { name: new RegExp(t('people.placeholder.add')) }),
    ).not.toBeInTheDocument()
  })

  it('adds one after another with the sheet still open', async () => {
    renderMembers()
    db().respond('rpc:add_placeholder_member', { data: 'p-one' })
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(t('people.placeholder.add')) }),
    )
    const sheet = await screen.findByRole('dialog', { name: t('people.placeholder.addTitle') })
    const name = within(sheet).getByLabelText(t('people.placeholder.nameLabel'))
    fireEvent.change(name, { target: { value: 'Jo' } })
    fireEvent.click(screen.getByRole('button', { name: t('people.placeholder.addAnother') }))
    expect(
      await screen.findByText(t('people.placeholder.added', { name: 'Jo' })),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('dialog', { name: t('people.placeholder.addTitle') }),
    ).toBeInTheDocument()
    await waitFor(() => expect(name).toHaveValue(''))
  })

  it('says so when the email belonged to someone already on Potluck', async () => {
    renderMembers()
    db()
      .respond('rpc:add_placeholder_member', { data: 'u-eli' })
      .respond('from:profiles', {
        data: [
          {
            id: 'u-eli',
            display_name: 'Eli Moss',
            avatar_path: null,
            deleted_at: null,
            is_placeholder: false,
          },
        ],
      })
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(t('people.placeholder.add')) }),
    )
    const sheet = await screen.findByRole('dialog', { name: t('people.placeholder.addTitle') })
    fireEvent.change(within(sheet).getByLabelText(t('people.placeholder.nameLabel')), {
      target: { value: 'Eli' },
    })
    fireEvent.change(within(sheet).getByLabelText(t('people.placeholder.emailLabel')), {
      target: { value: 'eli@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('people.placeholder.submit') }))
    expect(
      await screen.findByText(t('people.placeholder.addedExisting', { name: 'Eli Moss' })),
    ).toBeInTheDocument()
  })

  it('lets only whoever added a seat, or an admin, change its email', async () => {
    const asMember = group({
      members: [
        member(VIEWER, 'Ava Chen', 'member'),
        member('u-ben', 'Ben Ortiz', 'owner'),
        { ...member('p-pat', 'Pat Kim'), is_placeholder: true },
      ],
    })
    resetDb({
      tables: {
        ...groupTables(asMember),
        placeholders: [seat('p-pat', { created_by: 'u-ben' })],
        group_invites: [],
      },
    })
    renderWithProviders(<MembersPage groupId="g-hike" />, { path: '/groups/g-hike/members' })
    const menu = await openMenu('Pat Kim')
    fireEvent.click(within(menu).getByRole('button', { name: t('people.placeholder.edit') }))
    const sheet = await screen.findByRole('dialog', {
      name: t('people.placeholder.editTitle', { name: 'Pat Kim' }),
    })
    expect(within(sheet).getByLabelText(t('people.placeholder.nameLabel'))).toBeInTheDocument()
    expect(within(sheet).queryByLabelText(t('people.placeholder.emailLabel'))).toBeNull()
  })

  it('says leaving closes the group when only seats are left', async () => {
    renderMembers(group({ members: [member(VIEWER, 'Ava Chen', 'owner'), pat] }))
    expect(await screen.findByText(t('people.placeholder.leaveOnlySeats'))).toBeInTheDocument()
  })
})

describe('AddPlaceholderSheet over another form', () => {
  it('adds on Enter without submitting the form behind it', async () => {
    resetDb({ tables: { profiles: [] } })
    db().respond('rpc:add_placeholder_member', { data: 'p-new' })
    const outer = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    const onAdded = vi.fn()
    renderWithProviders(
      <form onSubmit={outer}>
        <AddPlaceholderSheet
          group={{ id: 'g-hike', name: 'Hike crew' }}
          open
          onOpenChange={() => undefined}
          onAdded={onAdded}
        />
      </form>,
      { path: '/new/expense' },
    )
    const sheet = await screen.findByRole('dialog', { name: t('people.placeholder.addTitle') })
    const name = within(sheet).getByLabelText(t('people.placeholder.nameLabel'))
    fireEvent.change(name, { target: { value: 'Jo' } })
    fireEvent.submit(name.closest('form')!)
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('p-new'))
    expect(outer).not.toHaveBeenCalled()
  })
})
