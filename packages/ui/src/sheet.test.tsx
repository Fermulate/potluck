import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'
import { ConfirmDialog } from './dialog'
import { Sheet, SheetContent, SheetTrigger } from './sheet'

function Harness() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button>Add expense</Button>
      </SheetTrigger>
      <SheetContent title="New expense" closeLabel="Close">
        <label>
          Description
          <input />
        </label>
        <button type="button">Save</button>
      </SheetContent>
    </Sheet>
  )
}

describe('Sheet', () => {
  it('opens from its trigger and is named by its title', async () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(await screen.findByRole('dialog', { name: 'New expense' })).toBeInTheDocument()
  })

  it('closes with the close button and returns focus to the trigger', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Add expense' })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Add expense' }))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('traps focus inside while open', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Add expense' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    for (let i = 0; i < 6; i++) {
      await userEvent.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await userEvent.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('works controlled', async () => {
    function Controlled() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <span>{open ? 'open' : 'closed'}</span>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent title="Settle up" closeLabel="Close" />
          </Sheet>
        </>
      )
    }
    render(<Controlled />)
    expect(screen.getByRole('dialog', { name: 'Settle up' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByText('closed')).toBeInTheDocument()
  })
})

describe('ConfirmDialog', () => {
  it('waits for the confirm action, then closes', async () => {
    let resolve!: () => void
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)))
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete expense?"
        confirmLabel="Delete"
        cancelLabel="Keep it"
        closeLabel="Close"
        tone="danger"
        onConfirm={onConfirm}
      />,
    )
    const confirm = screen.getByRole('button', { name: 'Delete' })
    await userEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(confirm).toBeDisabled()
    expect(onOpenChange).not.toHaveBeenCalled()
    resolve()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('cancels without confirming', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Leave group?"
        confirmLabel="Leave"
        cancelLabel="Stay"
        closeLabel="Close"
        onConfirm={onConfirm}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Stay' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
