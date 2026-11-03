import { moneyKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GroupPicker } from './group-picker'
import { group, members, renderWithClient, seededClient } from './test-utils'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

const direct = {
  ...group,
  id: 'direct-ben',
  name: '',
  emoji: null,
  is_direct: true,
  members: members.filter((m) => m.display_name !== 'Cleo Park'),
}

describe('GroupPicker', () => {
  it('lists your groups, naming one to one tabs after the friend', () => {
    const onPick = vi.fn()
    const client = seededClient((c) => c.setQueryData(moneyKeys.myGroups(), [group, direct]))
    renderWithClient(<GroupPicker title="Which group?" hint="Pick one" onPick={onPick} />, client)
    expect(screen.getByRole('heading', { name: 'Which group?' })).toBeInTheDocument()
    expect(screen.getByText('Pick one')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Hike crew/ }))
    expect(onPick).toHaveBeenCalledWith(group)
    fireEvent.click(screen.getByRole('button', { name: /^Ben Okafor/ }))
    expect(onPick).toHaveBeenLastCalledWith(direct)
  })

  it('explains when there are no groups yet', () => {
    const client = seededClient((c) => c.setQueryData(moneyKeys.myGroups(), []))
    renderWithClient(<GroupPicker title="Which group?" onPick={vi.fn()} />, client)
    expect(screen.getByText(t('expenses.pickGroup.none'))).toBeInTheDocument()
  })
})
