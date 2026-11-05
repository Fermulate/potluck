import type * as Api from '@potluck/api'
import type { PlanEventWithGroup, PlanMember } from '@potluck/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}))
vi.mock('./viewer', () => ({
  useViewer: () => ({ userId: 'me', timeZone: 'UTC', profile: undefined }),
}))
vi.mock('./use-event', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-event')>()),
  useEventRealtime: () => {},
}))

const event = {
  id: 'e1',
  group_id: 'g1',
  title: 'Taco night',
  status: 'polling',
} as unknown as PlanEventWithGroup
const loadEvent = vi.fn<() => Promise<PlanEventWithGroup>>()
const loadMembers = vi.fn<() => Promise<PlanMember[]>>()
vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof Api>()
  return {
    ...actual,
    planQueries: {
      ...actual.planQueries,
      event: (_client: unknown, id: string) => ({ queryKey: ['event', id], queryFn: loadEvent }),
      members: (_client: unknown, id: string) => ({
        queryKey: ['members', id],
        queryFn: loadMembers,
      }),
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
})
