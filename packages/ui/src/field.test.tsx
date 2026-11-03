import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Field, Input, TextArea } from './field'

describe('Field', () => {
  it('describes the control with its hint', () => {
    render(
      <Field label="Name" hint="As your friends know you">
        <Input />
      </Field>,
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAccessibleDescription(
      'As your friends know you',
    )
  })

  it('describes the control with only the error once one shows', () => {
    render(
      <Field label="Name" hint="As your friends know you" error="Add a name">
        <Input />
      </Field>,
    )
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveAccessibleDescription('Add a name')
    for (const id of input.getAttribute('aria-describedby')!.split(' ')) {
      expect(document.getElementById(id)).not.toBeNull()
    }
  })
})

describe('Input', () => {
  it('works outside a Field with its own id', () => {
    render(<Input id="search" aria-label="Search" />)
    const input = screen.getByRole('textbox', { name: 'Search' })
    expect(input).toHaveAttribute('id', 'search')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
  })

  it('keeps leading and trailing adornments next to the input', () => {
    render(
      <Field label="Amount" error="Too much">
        <Input leading={<span>€</span>} trailing={<button type="button">Max</button>} />
      </Field>,
    )
    const input = screen.getByRole('textbox', { name: 'Amount' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.parentElement).toHaveTextContent('€Max')
    expect(screen.getByRole('button', { name: 'Max' })).toBeInTheDocument()
  })

  it('supports a leading adornment alone', () => {
    render(<Input aria-label="Find" leading={<span>?</span>} />)
    expect(screen.getByRole('textbox', { name: 'Find' }).parentElement).toHaveTextContent('?')
  })
})

describe('TextArea', () => {
  it('is a multi-line textbox wired to its Field', () => {
    render(
      <Field label="Notes" hint="Only the group sees this" hideLabel>
        <TextArea />
      </Field>,
    )
    const area = screen.getByRole('textbox', { name: 'Notes' })
    expect(area.tagName).toBe('TEXTAREA')
    expect(area).toHaveAttribute('rows', '3')
    expect(area).toHaveAccessibleDescription('Only the group sees this')
  })

  it('takes its own id and rows outside a Field', () => {
    render(<TextArea id="bio" rows={6} aria-label="Bio" />)
    const area = screen.getByRole('textbox', { name: 'Bio' })
    expect(area).toHaveAttribute('id', 'bio')
    expect(area).toHaveAttribute('rows', '6')
  })
})
