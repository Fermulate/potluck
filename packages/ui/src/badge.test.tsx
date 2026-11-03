import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Badge, Chip } from './badge'

describe('Badge', () => {
  it('shows its label and passes attributes through', () => {
    render(
      <Badge tone="tomato" title="Overdue" data-testid="badge">
        Due today
      </Badge>,
    )
    const badge = screen.getByTestId('badge')
    expect(badge).toHaveTextContent('Due today')
    expect(badge).toHaveAttribute('title', 'Overdue')
  })

  it('keeps the dot and icon out of the accessible text', () => {
    render(
      <Badge dot icon={<svg data-testid="icon" />}>
        Paid
      </Badge>,
    )
    const badge = screen.getByText('Paid')
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(badge.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2)
    expect(badge).toHaveTextContent(/^Paid$/)
  })
})

describe('Chip', () => {
  it('is a button that announces its pressed state', async () => {
    function Harness() {
      const [on, setOn] = useState(false)
      return (
        <Chip selected={on} onClick={() => setOn((v) => !v)}>
          Unsettled
        </Chip>
      )
    }
    render(<Harness />)
    const chip = screen.getByRole('button', { name: 'Unsettled' })
    expect(chip).toHaveAttribute('type', 'button')
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('forwards its ref, type and icon, and stays inert when disabled', async () => {
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    render(
      <form>
        <Chip ref={ref} type="submit" disabled onClick={onClick} icon={<svg data-testid="i" />}>
          Apply
        </Chip>
      </form>,
    )
    const chip = screen.getByRole('button', { name: 'Apply' })
    expect(ref.current).toBe(chip)
    expect(chip).toHaveAttribute('type', 'submit')
    expect(screen.getByTestId('i').parentElement).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(chip)
    expect(onClick).not.toHaveBeenCalled()
  })
})
