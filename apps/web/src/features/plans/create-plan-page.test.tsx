import type * as Api from '@potluck/api'
import type { PlanMember } from '@potluck/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Radix measures controls with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}))

const members: PlanMember[] = [
  { userId: 'me', displayName: 'Ava Chen', role: 'owner', avatarPath: null, deleted: false },
  { userId: 'ben', displayName: 'Ben Ortiz', role: 'member', avatarPath: null, deleted: false },
  { userId: 'cleo', displayName: 'Cleo Park', role: 'member', avatarPath: null, deleted: false },
]

const createPlanEvent = vi.fn()
const requestAvailability = vi.fn()
vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof Api>()
  return {
    ...actual,
    createPlanEvent: (...args: unknown[]) => createPlanEvent(...args),
    requestAvailability: (...args: unknown[]) => requestAvailability(...args),
    planQueries: {
      ...actual.planQueries,
      members: (_client: unknown, groupId: string) => ({
        queryKey: ['members', groupId],
        queryFn: async () => members,
      }),
    },
  }
})

const { PlanForm } = await import('./create-plan-page')

const GROUP = '10000000-0000-4000-8000-000000000001'

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PlanForm
        groups={[{ id: GROUP, name: 'Hike crew', emoji: '🥾' }]}
        groupId={GROUP}
        onGroupChange={() => {}}
        timeZone="America/Los_Angeles"
        viewerId="me"
      />
    </QueryClientProvider>,
  )
}

describe('PlanForm', () => {
  beforeEach(() => {
    createPlanEvent.mockReset().mockResolvedValue({ id: 'new-event' })
    requestAvailability.mockReset().mockResolvedValue(2)
    navigate.mockReset()
  })

  it('asks for a title before creating anything', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Start the poll' }))
    expect(await screen.findByText('Required.')).toBeInTheDocument()
    expect(screen.getByLabelText("What's the plan?")).toHaveAttribute('aria-invalid', 'true')
    expect(createPlanEvent).not.toHaveBeenCalled()
  })

  it('creates the poll in the viewer zone, nudges the picked members, then opens it', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText("What's the plan?"), {
      target: { value: 'Taco night' },
    })
    fireEvent.click(screen.getByRole('button', { name: '🌮' }))
    // Everyone is picked by default; drop Cleo.
    await screen.findByText('Cleo Park')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cleo Park' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start the poll' }))

    await waitFor(() => expect(createPlanEvent).toHaveBeenCalledTimes(1))
    expect(createPlanEvent.mock.calls[0]![1]).toMatchObject({
      group_id: GROUP,
      title: 'Taco night',
      emoji: '🌮',
      timezone: 'America/Los_Angeles',
      slot_minutes: 30,
      duration_minutes: 120,
      min_attendees: 2,
      location: null,
    })
    await waitFor(() =>
      expect(requestAvailability).toHaveBeenCalledWith(expect.anything(), 'new-event', ['ben']),
    )
    expect(navigate).toHaveBeenCalledWith({
      to: '/plans/$eventId',
      params: { eventId: 'new-event' },
    })
  })
})
