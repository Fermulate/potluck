import type * as ApiModule from '@potluck/api'
import type * as AuthModule from '@/lib/auth'
import type { InvitePreview } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { JoinPage } from './join-page'

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; user_metadata: Record<string, unknown> } },
  preview: null as InvitePreview | null,
  failure: null as Error | null,
  acceptInvite: vi.fn(async () => 'g-hike'),
}))

vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    invitePreviewQueryOptions: () => ({
      queryKey: ['test', 'preview'],
      queryFn: async () => {
        if (state.failure) throw state.failure
        if (!state.preview) throw new Error('invite_not_found')
        return state.preview
      },
    }),
    acceptInvite: state.acceptInvite,
  }
})

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useSession: () => state.session,
}))

const valid: InvitePreview = {
  group_id: 'g-hike',
  name: 'Hike crew',
  emoji: '🥾',
  color: 'olive',
  cover_path: null,
  member_count: 6,
  first_names: ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli'],
  status: 'valid',
  is_member: false,
}

describe('JoinPage', () => {
  beforeEach(() => {
    state.session = null
    state.preview = valid
    state.failure = null
    vi.clearAllMocks()
  })

  it('offers a retry when the invite could not be loaded, instead of calling it dead', async () => {
    state.failure = new TypeError('Failed to fetch')
    renderWithProviders(<JoinPage code="hikecrew-demo" />, { path: '/join/hikecrew-demo' })
    expect(
      await screen.findByRole('heading', { name: t('invites.join.loadFailedTitle') }),
    ).toBeInTheDocument()
    expect(screen.queryByText(t('invites.invalid.title'))).not.toBeInTheDocument()

    state.failure = null
    fireEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { name: 'Hike crew' })).toBeInTheDocument()
  })

  it('still says gone cold for an unknown code', async () => {
    state.preview = null
    renderWithProviders(<JoinPage code="nope" />, { path: '/join/nope' })
    expect(await screen.findByText(t('invites.invalid.notFound'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.retry') })).not.toBeInTheDocument()
  })

  it('shows the group and who is already in', async () => {
    renderWithProviders(<JoinPage code="hikecrew-demo" />, { path: '/join/hikecrew-demo' })
    expect(await screen.findByRole('heading', { name: 'Hike crew' })).toBeInTheDocument()
    expect(screen.getByText('Ava wants you at the table.')).toBeInTheDocument()
    expect(screen.getByText('Ava, Ben, Cleo and 3 others are already in.')).toBeInTheDocument()
  })

  it('sends signed out visitors to sign up and back again', async () => {
    renderWithProviders(<JoinPage code="hikecrew-demo" />, { path: '/join/hikecrew-demo' })
    const signUp = await screen.findByRole('link', { name: 'Create an account to join' })
    expect(signUp).toHaveAttribute('href', '/sign-up?redirect=%2Fjoin%2Fhikecrew-demo')
    expect(screen.getByRole('link', { name: 'Sign in to join' })).toHaveAttribute(
      'href',
      '/sign-in?redirect=%2Fjoin%2Fhikecrew-demo',
    )
  })

  it('joins in one tap when signed in and opens the group', async () => {
    state.session = { user: { id: 'u-fay', user_metadata: { onboarded: true } } }
    const { router } = renderWithProviders(<JoinPage code="hikecrew-demo" />, {
      path: '/join/hikecrew-demo',
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Join Hike crew' }))
    await waitFor(() =>
      expect(state.acceptInvite).toHaveBeenCalledWith(expect.anything(), 'hikecrew-demo'),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-hike'))
  })

  it('sends a signed in account that has not finished onboarding to welcome first', async () => {
    state.session = { user: { id: 'u-fay', user_metadata: {} } }
    renderWithProviders(<JoinPage code="hikecrew-demo" />, { path: '/join/hikecrew-demo' })
    expect(await screen.findByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/welcome?redirect=%2Fjoin%2Fhikecrew-demo',
    )
    expect(screen.queryByRole('button', { name: 'Join Hike crew' })).not.toBeInTheDocument()
    expect(state.acceptInvite).not.toHaveBeenCalled()
  })

  it('explains a dead link', async () => {
    state.preview = { ...valid, status: 'expired' }
    renderWithProviders(<JoinPage code="hikecrew-demo" />, { path: '/join/hikecrew-demo' })
    expect(await screen.findByText('This invite has gone cold')).toBeInTheDocument()
    expect(screen.getByText('This link has expired. Ask for a fresh one.')).toBeInTheDocument()
  })

  it('says an archived group is not taking people', async () => {
    state.session = { user: { id: 'u-fay', user_metadata: { onboarded: true } } }
    state.preview = { ...valid, status: 'archived' }
    renderWithProviders(<JoinPage code="hikecrew-demo" />, { path: '/join/hikecrew-demo' })
    expect(
      await screen.findByText('This group has been archived, so it is not taking new people.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join Hike crew' })).not.toBeInTheDocument()
  })

  it('does not offer to join when a block stands in the way', async () => {
    state.session = { user: { id: 'u-fay', user_metadata: { onboarded: true } } }
    state.preview = { ...valid, status: 'blocked' }
    renderWithProviders(<JoinPage code="hikecrew-demo" />, { path: '/join/hikecrew-demo' })
    expect(await screen.findByText('You cannot join this group.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join Hike crew' })).not.toBeInTheDocument()
  })

  describe('a saved seat', () => {
    const seat: InvitePreview = {
      ...valid,
      placeholder_name: 'Sam',
      email_hint: 's***@example.com',
    }

    it('says whose seat it is and which email takes it', async () => {
      state.preview = seat
      renderWithProviders(<JoinPage code="sam-seat" />, { path: '/join/sam-seat' })
      expect(await screen.findByText(t('people.claim.title'))).toBeInTheDocument()
      expect(
        screen.getByText(t('people.claim.seatFor', { host: 'Ava', name: 'Sam' })),
      ).toBeInTheDocument()
      expect(
        screen.getByText(t('people.claim.emailNote', { email: 's***@example.com' })),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: t('people.claim.signUp') })).toHaveAttribute(
        'href',
        '/sign-up?redirect=%2Fjoin%2Fsam-seat',
      )
    })

    it('takes the seat in one tap and welcomes them to their history', async () => {
      state.session = { user: { id: 'u-sam', user_metadata: { onboarded: true } } }
      state.preview = seat
      const { router } = renderWithProviders(
        <>
          <JoinPage code="sam-seat" />
          <Toaster label="Notifications" />
        </>,
        { path: '/join/sam-seat' },
      )
      fireEvent.click(await screen.findByRole('button', { name: t('people.claim.accept') }))
      expect(
        await screen.findByText(t('people.claim.welcome', { name: 'Sam' })),
      ).toBeInTheDocument()
      await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-hike'))
    })
  })

  it('explains when a seat is saved for another email than the one signed in', async () => {
    state.session = { user: { id: 'u-cleo', user_metadata: { onboarded: true } } }
    state.preview = {
      ...valid,
      placeholder_name: 'Sam',
      email_hint: 's***@example.com',
      email_matches: false,
    }
    renderWithProviders(<JoinPage code="sam-seat" />, { path: '/join/sam-seat' })
    expect(
      await screen.findByText(t('people.claim.wrongEmail', { email: 's***@example.com' })),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('people.claim.switchAccount') }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('people.claim.accept') })).toBeNull()
  })
})
