import type * as Api from '@potluck/api'
import type {
  EventGuest,
  GuestSlotRow,
  PlanAvailabilityRow,
  PlanEventWithGroup,
  PlanMember,
} from '@potluck/api'
import { setAvailability } from '@potluck/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as UseEvent from './use-event'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}))
vi.mock('./viewer', () => ({
  useViewer: () => ({ userId: 'me', timeZone: 'UTC', profile: undefined }),
}))
vi.mock('./plan-expenses', () => ({ PlanExpenses: () => null }))
vi.mock('./use-event', async (importOriginal) => ({
  ...(await importOriginal<typeof UseEvent>()),
  useEventRealtime: () => {},
}))

const event = {
  id: 'e1',
  group_id: 'g1',
  title: 'Taco night',
  status: 'polling',
} as unknown as PlanEventWithGroup
const poll = {
  ...event,
  emoji: null,
  description: null,
  location: null,
  created_by: 'ben',
  window_start: '2026-06-12',
  window_end: '2026-06-13',
  day_start_minute: 18 * 60,
  day_end_minute: 20 * 60,
  slot_minutes: 30,
  duration_minutes: 60,
  min_attendees: 2,
  timezone: 'UTC',
  rsvp_deadline: null,
  starts_at: null,
  ends_at: null,
  group: { name: 'Supper club', emoji: null, color: null },
} as unknown as PlanEventWithGroup
const people: PlanMember[] = [
  { userId: 'me', role: 'member', displayName: 'Noor', avatarPath: null, deleted: false },
  { userId: 'ben', role: 'owner', displayName: 'Ben', avatarPath: null, deleted: false },
]
const loadEvent = vi.fn<() => Promise<PlanEventWithGroup>>()
const loadMembers = vi.fn<() => Promise<PlanMember[]>>()
const loadAvailability = vi.fn<() => Promise<PlanAvailabilityRow[]>>()
const loadGuests = vi.fn<() => Promise<EventGuest[]>>(async () => [])
const loadGuestSlots = vi.fn<() => Promise<GuestSlotRow[]>>(async () => [])
vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof Api>()
  const fixed = (key: readonly unknown[], data: unknown) => ({
    queryKey: key,
    queryFn: async () => data,
  })
  return {
    ...actual,
    setAvailability: vi.fn(async () => {}),
    guestQueries: {
      ...actual.guestQueries,
      links: (_client: unknown, id: string) => fixed(actual.guestKeys.links(id), []),
      guests: (_client: unknown, id: string) => ({
        queryKey: actual.guestKeys.guests(id),
        queryFn: loadGuests,
      }),
      slots: (_client: unknown, id: string) => ({
        queryKey: actual.guestKeys.slots(id),
        queryFn: loadGuestSlots,
      }),
    },
    planQueries: {
      ...actual.planQueries,
      event: (_client: unknown, id: string) => ({ queryKey: ['event', id], queryFn: loadEvent }),
      members: (_client: unknown, id: string) => ({
        queryKey: ['members', id],
        queryFn: loadMembers,
      }),
      availability: (_client: unknown, id: string) => ({
        queryKey: actual.plansKeys.availability(id),
        queryFn: loadAvailability,
      }),
      requests: (_client: unknown, id: string) => fixed(actual.plansKeys.requests(id), []),
      rsvps: (_client: unknown, id: string) => fixed(actual.plansKeys.rsvps(id), []),
      comments: (_client: unknown, id: string) => fixed(actual.plansKeys.comments(id), []),
      busy: (_client: unknown, userId: string, range: { from: string; to: string }) =>
        fixed(actual.plansKeys.busy(userId, range.from, range.to), []),
      bestSlots: (_client: unknown, id: string) =>
        fixed(actual.plansKeys.bestSlots(id), [
          {
            starts_at: '2026-06-12T18:00:00+00:00',
            ends_at: '2026-06-12T19:00:00+00:00',
            missing: ['me'],
            score: 1,
            yes_count: 1,
            maybe_count: 0,
          },
        ]),
    },
  }
})

const { EventPage } = await import('./event-page')

describe('EventPage', () => {
  beforeEach(() => {
    loadEvent.mockReset().mockResolvedValue(event)
    loadMembers.mockReset()
  })

  it('shows an error with a retry when the member list fails, instead of a skeleton', async () => {
    loadMembers
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValue(new Promise<PlanMember[]>(() => {}))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <EventPage eventId="e1" />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Something burned in the kitchen. Try again?')).toBeVisible()
    expect(document.querySelector('[aria-busy]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(loadMembers).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByText('Something burned in the kitchen. Try again?')).toBeNull(),
    )
    expect(document.querySelector('[aria-busy]')).not.toBeNull()
  })

  it('keeps the painter above best times on a phone once the first stroke lands', async () => {
    loadEvent.mockResolvedValue(poll)
    loadMembers.mockResolvedValue(people)
    const bensRow: PlanAvailabilityRow = {
      event_id: 'e1',
      user_id: 'ben',
      slot_start: '2026-06-12T18:00:00+00:00',
      level: 'yes',
    }
    loadAvailability.mockResolvedValue([bensRow])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <EventPage eventId="e1" />
      </QueryClientProvider>,
    )
    const painter = await screen.findByRole('heading', { name: 'When are you free?' })
    await screen.findByRole('region', { name: 'Best times' })
    const painterFirst = () => {
      const best = screen.getByRole('region', { name: 'Best times' })
      return Boolean(painter.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_FOLLOWING)
    }
    expect(painterFirst()).toBe(true)

    const [cell] = screen.getAllByRole('gridcell')
    cell!.focus()
    fireEvent.keyDown(cell!, { key: ' ' })
    await waitFor(() => expect(cell).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(setAvailability).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: 'When are you free?' })).toBe(painter)
    expect(painterFirst()).toBe(true)
  })

  it('counts guests in the heatmap, tagged, and lists them on the plan', async () => {
    loadEvent.mockResolvedValue(poll)
    loadMembers.mockResolvedValue(people)
    const at = '2026-06-12T18:00:00+00:00'
    loadAvailability.mockResolvedValue([
      { event_id: 'e1', user_id: 'me', slot_start: at, level: 'yes' },
      { event_id: 'e1', user_id: 'ben', slot_start: at, level: 'yes' },
    ])
    loadGuests.mockResolvedValue([
      { id: 'g-ana', link_id: 'l1', display_name: 'Ana', created_at: '2026-06-01T00:00:00Z' },
    ])
    loadGuestSlots.mockResolvedValue([
      { guest_id: 'g-ana', event_id: 'e1', slot_start: at, level: 'maybe' },
    ])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <EventPage eventId="e1" />
      </QueryClientProvider>,
    )

    const grid = await screen.findByRole('grid', { name: "Everyone's availability for Taco night" })
    const cell = grid.querySelector<HTMLElement>('[data-slot="2026-06-12T18:00:00.000Z"]')!
    await waitFor(() => expect(cell).toHaveAccessibleName(/2 free, 1 maybe/))
    fireEvent.focus(cell)
    expect(screen.getByText(/Maybe: Ana \(guest\)/)).toBeInTheDocument()
    expect(screen.getByText('3 of 3 free')).toBeInTheDocument()
    expect(screen.getAllByText('1 guest answered').length).toBeGreaterThan(0)
  })

  it('says where a scheduled plan is once', async () => {
    loadEvent.mockResolvedValue({
      ...poll,
      status: 'scheduled',
      location: "Maya's place",
      starts_at: '2026-06-12T18:00:00+00:00',
      ends_at: '2026-06-12T19:00:00+00:00',
    } as PlanEventWithGroup)
    loadMembers.mockResolvedValue(people)
    loadAvailability.mockResolvedValue([])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <EventPage eventId="e1" />
      </QueryClientProvider>,
    )
    expect(await screen.findByText("Maya's place")).toBeVisible()
    expect(screen.getAllByText("Maya's place")).toHaveLength(1)
    expect(screen.getAllByText('Organized by Ben').length).toBeGreaterThan(0)
  })
})
