import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Field, Input } from './field'

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
