import type * as AuthModule from '@/lib/auth'
import type { GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { group, groupTables, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, emitChange, resetDb, subscriptions } from '@/test/supabase'
import { GroupNotesPage } from './notes-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

const board = (body: string, version: number, updated_by: string | null = 'u-ben') => ({
  group_id: 'g-hike',
  body,
  version,
  updated_by,
  updated_at: '2026-11-13T09:00:00Z',
})

function renderNotes(seeded: GroupDetail = group(), boards = [board('Wifi: potluck123', 3)]) {
  resetDb({ tables: { ...groupTables(seeded), group_whiteboards: boards } })
  return renderWithProviders(
    <>
      <GroupNotesPage groupId="g-hike" />
      <Toaster label="Notifications" />
    </>,
    { path: '/groups/g-hike/notes' },
  )
}

const box = () => screen.getByRole('textbox', { name: t('groups.notes.label') })

describe('GroupNotesPage', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the notes, who wrote them, and listens for edits', async () => {
    renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    expect(screen.getByText(/Edited by Ben/)).toBeInTheDocument()
    expect(subscriptions()).toContainEqual({
      table: 'group_whiteboards',
      filter: 'group_id=eq.g-hike',
    })
  })

  it('saves a moment after typing stops, on top of the version it started from', async () => {
    renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond('rpc:save_group_whiteboard', { data: board('Bins on Tuesday', 4, VIEWER) })
    fireEvent.change(box(), { target: { value: 'Bins on Tuesday' } })
    expect(screen.getByText(t('groups.notes.unsaved'))).toBeInTheDocument()

    await waitFor(() =>
      expect(db().rpcArgs('save_group_whiteboard')).toEqual([
        { group_id: 'g-hike', body: 'Bins on Tuesday', base_version: 3 },
      ]),
    )
    expect(await screen.findByText(t('groups.notes.saved'))).toBeInTheDocument()
  })

  it('saves right away when the box loses focus', async () => {
    renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond('rpc:save_group_whiteboard', { data: board('Spare key: Cleo', 4, VIEWER) })
    fireEvent.change(box(), { target: { value: 'Spare key: Cleo' } })
    fireEvent.blur(box())
    // Well before the pause that saves while typing.
    await waitFor(() => expect(db().rpcArgs('save_group_whiteboard')).toHaveLength(1), {
      timeout: 400,
    })
  })

  it('saves what was typed when the person leaves before the pause', async () => {
    const { router } = renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond('rpc:save_group_whiteboard', { data: board('Bins on Tuesday', 4, VIEWER) })
    fireEvent.change(box(), { target: { value: 'Bins on Tuesday' } })
    await act(() => router.navigate({ to: '/groups' }))

    expect(screen.getByText('elsewhere')).toBeInTheDocument()
    await waitFor(() =>
      expect(db().rpcArgs('save_group_whiteboard')).toEqual([
        { group_id: 'g-hike', body: 'Bins on Tuesday', base_version: 3 },
      ]),
    )
  })

  it('saves what was typed when the page is closed', async () => {
    renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond('rpc:save_group_whiteboard', { data: board('Spare key: Cleo', 4, VIEWER) })
    fireEvent.change(box(), { target: { value: 'Spare key: Cleo' } })
    window.dispatchEvent(new Event('pagehide'))

    await waitFor(() => expect(db().rpcArgs('save_group_whiteboard')).toHaveLength(1), {
      timeout: 400,
    })
  })

  it('asks before leaving text a conflict is holding back', async () => {
    const { router } = renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond('rpc:save_group_whiteboard', {
      error: { message: 'whiteboard_conflict', code: '23514' },
    })
    db().respond('from:group_whiteboards', { data: board('Their text', 4, 'u-ben') })
    fireEvent.change(box(), { target: { value: 'My text' } })
    await screen.findByText(t('groups.notes.conflict', { name: 'Ben' }))

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    act(() => void router.navigate({ to: '/groups' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(t('groups.notes.leaveUnsaved')))
    expect(router.state.location.pathname).toBe('/groups/g-hike/notes')
    expect(box()).toHaveValue('My text')
  })

  it('takes in an edit from someone else when nothing is typed over it', async () => {
    renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond('from:group_whiteboards', { data: board('Wifi changed to soup', 4, 'u-cleo') })
    act(() => emitChange('group_whiteboards', 'UPDATE', { group_id: 'g-hike' }))

    await waitFor(() => expect(box()).toHaveValue('Wifi changed to soup'))
    expect(screen.getByText(t('groups.notes.theyEdited', { name: 'Cleo' }))).toBeInTheDocument()
  })

  it('lets the person choose when a newer version arrives while they type', async () => {
    renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond('rpc:save_group_whiteboard', {
      error: { message: 'whiteboard_conflict', code: '23514' },
    })
    db().respond('from:group_whiteboards', { data: board('Their text', 4, 'u-ben') })
    fireEvent.change(box(), { target: { value: 'My text' } })

    expect(await screen.findByText(t('groups.notes.conflict', { name: 'Ben' }))).toBeInTheDocument()
    expect(box()).toHaveValue('My text')

    fireEvent.click(screen.getByRole('button', { name: t('groups.notes.useTheirs') }))
    expect(box()).toHaveValue('Their text')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the person’s own text and saves it over the newer version', async () => {
    renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond(
      'rpc:save_group_whiteboard',
      { error: { message: 'whiteboard_conflict', code: '23514' } },
      { data: board('Mine wins', 5, VIEWER) },
    )
    db().respond('from:group_whiteboards', { data: board('Their text', 4, 'u-ben') })
    fireEvent.change(box(), { target: { value: 'Mine wins' } })
    fireEvent.click(await screen.findByRole('button', { name: t('groups.notes.keepMine') }))

    await waitFor(() => expect(db().rpcArgs('save_group_whiteboard')).toHaveLength(2))
    expect(db().rpcArgs('save_group_whiteboard')[1]).toEqual({
      group_id: 'g-hike',
      body: 'Mine wins',
      base_version: 4,
    })
  })

  it('keeps mine on top of the newest version even before the refetch has landed', async () => {
    renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond(
      'rpc:save_group_whiteboard',
      { error: { message: 'whiteboard_conflict', code: '23514' } },
      { data: board('Mine wins', 5, VIEWER) },
    )
    // The refetch right after the conflict still reads the old row; the next one has Ben's.
    db().respond(
      'from:group_whiteboards',
      { data: board('Wifi: potluck123', 3) },
      { data: board('Their text', 4, 'u-ben') },
    )
    fireEvent.change(box(), { target: { value: 'Mine wins' } })
    const keep = await screen.findByRole('button', { name: t('groups.notes.keepMine') })
    await waitFor(() => expect(db().queries('group_whiteboards')).toHaveLength(2))
    fireEvent.click(keep)

    await waitFor(() => expect(db().rpcArgs('save_group_whiteboard')).toHaveLength(2))
    expect(db().rpcArgs('save_group_whiteboard')[1]).toEqual({
      group_id: 'g-hike',
      body: 'Mine wins',
      base_version: 4,
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows other save errors as a toast', async () => {
    renderNotes()
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    db().respond('rpc:save_group_whiteboard', {
      error: { message: 'whiteboard_too_long', code: '22023' },
    })
    fireEvent.change(box(), { target: { value: 'Long' } })
    fireEvent.blur(box())
    expect(await screen.findByText(t('errors.codes.whiteboard_too_long'))).toBeInTheDocument()
    // Not retried on a timer; the next edit tries again.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(db().rpcArgs('save_group_whiteboard')).toHaveLength(1)
    fireEvent.change(box(), { target: { value: 'Longer' } })
    await waitFor(() => expect(db().rpcArgs('save_group_whiteboard')).toHaveLength(2))
  })

  it('is read only in an archived group', async () => {
    renderNotes(group({ archived_at: '2026-10-01T00:00:00Z' }))
    await waitFor(() => expect(box()).toHaveValue('Wifi: potluck123'))
    expect(box()).toHaveAttribute('readonly')
    expect(screen.getByText(t('groups.notes.archived'))).toBeInTheDocument()
  })

  it('starts empty, then lists who edited and when', async () => {
    renderNotes(group(), [])
    await waitFor(() => expect(box()).toHaveValue(''))
    expect(box()).toHaveAttribute('placeholder', t('groups.notes.placeholder'))

    db().respond('from:activity', {
      data: [
        {
          id: 'a1',
          actor_id: 'u-ben',
          created_at: '2026-11-13T09:00:00Z',
          data: { excerpt: 'Bins on Tuesday' },
        },
        { id: 'a2', actor_id: VIEWER, created_at: '2026-11-12T09:00:00Z', data: {} },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: t('groups.notes.history') }))
    expect(await screen.findByText('Bins on Tuesday')).toBeInTheDocument()
    expect(screen.getByText('Ben')).toBeInTheDocument()
    expect(screen.getByText(t('activity.you'))).toBeInTheDocument()
  })

  it('says when nobody has edited yet', async () => {
    renderNotes(group(), [])
    db().respond('from:activity', { data: [] })
    fireEvent.click(await screen.findByRole('button', { name: t('groups.notes.history') }))
    expect(await screen.findByText(t('groups.notes.historyEmpty'))).toBeInTheDocument()
  })
})
