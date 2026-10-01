import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarStack, initials } from './avatar'
import { Spinner } from './spinner'

afterEach(() => {
  vi.useRealTimers()
})

describe('Spinner', () => {
  it('stays hidden for the first 300ms so fast loads never flash it', () => {
    vi.useFakeTimers()
    render(<Spinner label="Loading balances" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('status', { name: 'Loading balances' })).toBeInTheDocument()
  })
})

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('Maya Okafor')).toBe('MO')
    expect(initials('Inês da Silva Duarte')).toBe('ID')
    expect(initials('theo')).toBe('T')
    expect(initials('   ')).toBe('?')
  })
})

describe('AvatarStack', () => {
  const people = ['Maya Okafor', 'Theo Lind', 'Priya Raman', 'Sam Ortiz', 'Jun Park'].map(
    (name, i) => ({ id: `u${i}`, name }),
  )

  it('shows up to max faces and counts the rest', () => {
    render(<AvatarStack people={people} max={3} label="5 going" />)
    expect(screen.getByRole('group', { name: '5 going' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Maya Okafor' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Sam Ortiz' })).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })
})
