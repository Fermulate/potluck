import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox, Switch } from './switch'

describe('Switch', () => {
  it('is a switch named by its label and described by its description', async () => {
    const onCheckedChange = vi.fn()
    render(
      <Switch
        label="Simplify debts"
        description="Fewer payments to settle up"
        onCheckedChange={onCheckedChange}
      />,
    )
    const toggle = screen.getByRole('switch', { name: 'Simplify debts' })
    expect(toggle).toHaveAccessibleDescription('Fewer payments to settle up')
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    expect(toggle).toBeChecked()
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('toggles when its label is clicked', async () => {
    render(<Switch label="Reminders" defaultChecked />)
    await userEvent.click(screen.getByText('Reminders'))
    expect(screen.getByRole('switch', { name: 'Reminders' })).not.toBeChecked()
  })

  it('renders alone with an aria-label and a given id, and forwards its ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Switch ref={ref} id="dark" aria-label="Dark mode" checked onCheckedChange={() => {}} />)
    const toggle = screen.getByRole('switch', { name: 'Dark mode' })
    expect(toggle).toHaveAttribute('id', 'dark')
    expect(toggle).toBeChecked()
    expect(toggle).not.toHaveAttribute('aria-describedby')
    expect(ref.current).toBe(toggle)
  })

  it('does not toggle when disabled', async () => {
    render(<Switch label="Locked" disabled />)
    const toggle = screen.getByRole('switch', { name: 'Locked' })
    await userEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(toggle).toBeDisabled()
  })
})

describe('Checkbox', () => {
  it('is a checkbox named by its label that toggles', async () => {
    function Harness() {
      const [checked, setChecked] = useState(false)
      return (
        <Checkbox
          label="Include Theo"
          description="He joined after this expense"
          checked={checked}
          onCheckedChange={(v) => setChecked(v === true)}
        />
      )
    }
    render(<Harness />)
    const box = screen.getByRole('checkbox', { name: 'Include Theo' })
    expect(box).toHaveAccessibleDescription('He joined after this expense')
    await userEvent.click(box)
    expect(box).toBeChecked()
    await userEvent.click(screen.getByText('Include Theo'))
    expect(box).not.toBeChecked()
  })

  it('shows a mixed state', () => {
    render(<Checkbox aria-label="Everyone" checked="indeterminate" />)
    expect(screen.getByRole('checkbox', { name: 'Everyone' })).toBePartiallyChecked()
  })
})
