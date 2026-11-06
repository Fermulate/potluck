import type { PlanBestSlot, PlanMember } from '@potluck/api'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BestTimes } from './best-times'

const member = (userId: string, displayName: string): PlanMember => ({
  userId,
  displayName,
  role: 'member',
  avatarPath: null,
  deleted: false,
})
const members = [member('a', 'Ava Chen'), member('b', 'Ben Ortiz'), member('c', 'Cleo Park')]

const slots: PlanBestSlot[] = [
  {
    starts_at: '2026-06-12T23:00:00+00:00',
    ends_at: '2026-06-13T01:00:00+00:00',
    yes_count: 2,
    maybe_count: 0,
    score: 2,
    missing: ['c'],
  },
  {
    starts_at: '2026-06-13T23:00:00+00:00',
    ends_at: '2026-06-14T01:00:00+00:00',
    yes_count: 1,
    maybe_count: 1,
    score: 1.5,
    missing: ['b'],
  },
]

describe('BestTimes', () => {
  it('shows the top pick with who is missing, and locks it in after confirming', async () => {
    const onLock = vi.fn().mockResolvedValue(undefined)
    render(<BestTimes slots={slots} members={members} timeZone="UTC" canLock onLock={onLock} />)
    expect(screen.getByText('Without Cleo')).toBeInTheDocument()
    expect(screen.getByText('2 yes, 0 maybe')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lock it in' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Lock in this time?')
    fireEvent.click(screen.getAllByRole('button', { name: 'Lock it in' }).at(-1)!)

    await waitFor(() => expect(onLock).toHaveBeenCalledWith('2026-06-12T23:00:00+00:00'))
  })

  it('lets organizers pick a runner up', async () => {
    const onLock = vi.fn().mockResolvedValue(undefined)
    render(<BestTimes slots={slots} members={members} timeZone="UTC" canLock onLock={onLock} />)
    fireEvent.click(screen.getByRole('button', { name: /^Pick this one/ }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getAllByRole('button', { name: 'Lock it in' }).at(-1)!)
    await waitFor(() => expect(onLock).toHaveBeenCalledWith('2026-06-13T23:00:00+00:00'))
  })

  it('hides lock in from people who cannot schedule', () => {
    render(
      <BestTimes slots={slots} members={members} timeZone="UTC" canLock={false} onLock={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Lock it in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pick this one/ })).not.toBeInTheDocument()
  })

  it('leaves closed accounts out of who is missing', () => {
    const closed: PlanMember = { ...member('z', 'Deleted user'), deleted: true }
    render(
      <BestTimes
        slots={[
          { ...slots[0]!, missing: ['z'] },
          { ...slots[1]!, missing: ['b', 'z'] },
        ]}
        members={[...members, closed]}
        timeZone="UTC"
        canLock={false}
        onLock={vi.fn()}
      />,
    )
    expect(screen.getByText('Everyone can make it')).toBeInTheDocument()
    expect(screen.getByText(/Without Ben$/)).toBeInTheDocument()
    expect(screen.queryByText(/Without\s*$/)).not.toBeInTheDocument()
  })

  it('counts missing people whose names it cannot read', () => {
    render(
      <BestTimes
        slots={[{ ...slots[0]!, missing: ['c'] }]}
        members={[...members.slice(0, 2), member('c', '')]}
        timeZone="UTC"
        canLock={false}
        onLock={vi.fn()}
      />,
    )
    expect(screen.getByText('1 cannot make it')).toBeInTheDocument()
  })

  it('has a hopeful empty state', () => {
    render(<BestTimes slots={[]} members={members} timeZone="UTC" canLock onLock={vi.fn()} />)
    expect(screen.getByText(/No time works for enough people yet/)).toBeInTheDocument()
  })
})
