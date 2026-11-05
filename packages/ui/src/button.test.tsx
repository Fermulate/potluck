import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, IconButton } from './button'

describe('Button', () => {
  it('fires onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disables itself while loading and keeps its name', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('defaults to type="button" so it never submits a form by accident', () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
        <Button>Cancel</Button>
      </form>,
    )
    screen.getByRole('button', { name: 'Cancel' }).click()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders its child when asChild is set', () => {
    render(
      <Button asChild>
        <a href="/groups">Groups</a>
      </Button>,
    )
    expect(screen.getByRole('link', { name: 'Groups' })).toHaveAttribute('href', '/groups')
  })
})

describe('IconButton', () => {
  it('is named by its label', () => {
    render(<IconButton label="Close" icon={<svg />} />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})
