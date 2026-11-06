import type * as Api from '@potluck/api'
import type { PlanAvailabilityRow, PlanEventWithGroup, PlanMember } from '@potluck/api'
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
vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof Api>()
  const fixed = (key: readonly unknown[], data: unknown) => ({
    queryKey: key,
    queryFn: async () => data,
  })
  return {
    ...actual,
    setAvailability: vi.fn(async () => {}),
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
