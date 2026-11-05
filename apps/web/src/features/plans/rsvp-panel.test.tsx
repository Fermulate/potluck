import type * as Api from '@potluck/api'
import { plansKeys, type PlanMember, type PlanRsvp } from '@potluck/api'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

let resolveSave: () => void = () => {}
const setRsvp = vi.fn(() => new Promise<void>((resolve) => (resolveSave = resolve)))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  setRsvp: (...args: unknown[]) => setRsvp(...(args as [])),
}))

const { RsvpPanel } = await import('./rsvp-panel')

const members: PlanMember[] = [
  { userId: 'me', displayName: 'Ava Chen', role: 'member', avatarPath: null, deleted: false },
  { userId: 'ben', displayName: 'Ben Ortiz', role: 'member', avatarPath: null, deleted: false },
]

function Harness({ deadline = null }: { deadline?: string | null }) {
  const { data } = useQuery<PlanRsvp[]>({
    queryKey: plansKeys.rsvps('e1'),
    queryFn: async () => [
      { event_id: 'e1', user_id: 'ben', status: 'going', updated_at: '2026-01-01T00:00:00Z' },
    ],
    staleTime: Infinity,
  })
  if (!data) return null
  return (
    <RsvpPanel
      eventId="e1"
      rsvps={data}
      members={members}
      viewerId="me"
      deadline={deadline}
      timeZone="UTC"
    />
  )
}

describe('RsvpPanel', () => {
  it('answers optimistically and saves', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    )
    const going = await screen.findByRole('radio', { name: 'Going' })
    expect(going).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(going)
    await waitFor(() => expect(going).toHaveAttribute('aria-checked', 'true'))
    expect(setRsvp).toHaveBeenCalledWith(expect.anything(), 'e1', 'me', 'going')
    resolveSave()
  })

  it('closes answers once the RSVP deadline has passed', async () => {
    setRsvp.mockClear()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Harness deadline="2020-01-01T12:00:00Z" />
      </QueryClientProvider>,
    )
    const going = await screen.findByRole('radio', { name: 'Going' })
    expect(screen.getByText(/RSVPs closed/)).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    fireEvent.click(going)
    expect(going).toHaveAttribute('aria-checked', 'false')
    expect(setRsvp).not.toHaveBeenCalled()
  })
})
