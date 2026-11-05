import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Avatar, AvatarStack, initials } from './avatar'
import { preferReducedMotion } from './test/motion'

describe('initials', () => {
  it('takes the first letters of the first and last word', () => {
    expect(initials('Maya Lopez')).toBe('ML')
    expect(initials('  ada   de la  cruz ')).toBe('AC')
    expect(initials('theo')).toBe('T')
  })

  it('keeps letters outside the basic plane whole', () => {
    expect(initials('😀 Smile')).toBe('😀S')
    expect(initials('élodie ñúñez')).toBe('ÉÑ')
  })

  it('falls back to a question mark for blank names', () => {
    expect(initials('   ')).toBe('?')
  })
})

describe('Avatar', () => {
  it('is an image named after the person, showing their initials', () => {
    render(<Avatar name="Maya Lopez" />)
    expect(screen.getByRole('img', { name: 'Maya Lopez' })).toHaveTextContent('ML')
  })

  it('shows one initial at the smallest size', () => {
    render(<Avatar name="Maya Lopez" size="xs" seed="u1" ring />)
    expect(screen.getByRole('img', { name: 'Maya Lopez' })).toHaveTextContent(/^M$/)
  })

  it('waits briefly for a photo before showing initials', async () => {
    render(<Avatar name="Theo" src="https://example.test/theo.jpg" />)
    expect(screen.queryByRole('img', { name: 'Theo' })).not.toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Theo' }, { timeout: 2000 })).toHaveTextContent(
      'T',
    )
  })
})

const people = [
  { id: 'u1', name: 'Ada Byron' },
  { id: 'u2', name: 'Bo Chen' },
  { id: 'u3', name: 'Cy Diaz' },
  { id: 'u4', name: 'Di Evans' },
  { id: 'u5', name: 'Ed Fox' },
  { id: 'u6', name: 'Flo Gray' },
]

describe('AvatarStack', () => {
  it('shows up to max faces and counts the rest', () => {
    render(<AvatarStack people={people} max={3} />)
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText('+3')).not.toHaveAttribute('aria-hidden')
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('is a labelled group with the counter hidden when it has a summary', () => {
    render(<AvatarStack people={people} label="Ada, Bo and 4 others" size="lg" />)
    expect(screen.getByRole('group', { name: 'Ada, Bo and 4 others' })).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(4)
    expect(screen.getByText('+2')).toHaveAttribute('aria-hidden', 'true')
  })

  it('has no counter when everyone fits', () => {
    render(<AvatarStack people={people.slice(0, 2)} animate />)
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual([
      'Ada Byron',
      'Bo Chen',
    ])
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('still shows everyone with reduced motion', () => {
    preferReducedMotion()
    render(<AvatarStack people={people.slice(0, 3)} animate size="xl" />)
    expect(screen.getAllByRole('img')).toHaveLength(3)
  })
})
