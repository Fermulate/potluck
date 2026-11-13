import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'
import { ConfirmDialog } from './dialog'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from './sheet'
import { preferReducedMotion } from './test/motion'

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

  it('stays open until answered when it is not dismissible', async () => {
    function Must() {
      const [open, setOpen] = useState(true)
      return (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent title="Save these" closeLabel="Close" dismissible={false}>
            <button type="button" onClick={() => setOpen(false)}>
              I saved them
            </button>
          </SheetContent>
        </Sheet>
      )
    }
    render(<Must />)
    await screen.findByRole('dialog', { name: 'Save these' })
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'I saved them' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
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

  it('returns focus to whatever opened a controlled sheet, after Escape', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Paid by
          </button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent title="Who paid?" closeLabel="Close">
              <button type="button">Ben</button>
            </SheetContent>
          </Sheet>
        </>
      )
    }
    render(<Controlled />)
    const opener = screen.getByRole('button', { name: 'Paid by' })
    await userEvent.click(opener)
    await screen.findByRole('dialog', { name: 'Who paid?' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })
})

describe('SheetContent', () => {
  it('is described by its description and shows a footer', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent
          title="Settle up"
          description="Record a payment to Bo"
          closeLabel="Close"
          variant="sheet"
          footer={
            <SheetClose asChild>
              <Button>Done</Button>
            </SheetClose>
          }
        >
          Body
        </SheetContent>
      </Sheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Settle up' })
    expect(dialog).toHaveAccessibleDescription('Record a payment to Bo')
    expect(dialog).toHaveTextContent('Body')
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('closes from a SheetClose in the footer', async () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet defaultOpen onOpenChange={onOpenChange}>
        <SheetContent
          title="Filters"
          closeLabel="Close"
          variant="dialog"
          size="lg"
          footer={
            <SheetClose asChild>
              <Button>Apply</Button>
            </SheetClose>
          }
        />
      </Sheet>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps a hidden title as the accessible name', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="Quick add" hideTitle closeLabel="Close" />
      </Sheet>,
    )
    expect(screen.getByRole('dialog', { name: 'Quick add' })).toBeInTheDocument()
  })

  it('opens and closes with reduced motion', async () => {
    preferReducedMotion()
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(await screen.findByRole('dialog', { name: 'New expense' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('must be used inside a Sheet', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<SheetContent title="Lost" closeLabel="Close" />)).toThrow(
      'SheetContent must be used inside <Sheet> or <Dialog>',
    )
    vi.mocked(console.error).mockRestore()
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

  it('stays open and usable when the confirm action fails', async () => {
    // The caller reports the error (a toast); the dialog must not leak an unhandled rejection.
    const onConfirm = vi.fn(() => Promise.reject(new Error('not allowed')))
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Lock it in?"
        confirmLabel="Lock it in"
        cancelLabel="Back"
        closeLabel="Close"
        onConfirm={onConfirm}
      />,
    )
    const confirm = screen.getByRole('button', { name: 'Lock it in' })
    await userEvent.click(confirm)
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
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
