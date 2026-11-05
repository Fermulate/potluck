import { useState, type ReactNode } from 'react'
import { Button } from './button'
import { Sheet, SheetClose, SheetContent, SheetTrigger, type SheetContentProps } from './sheet'

/** Same root as `Sheet`; content defaults to a centered dialog everywhere. */
export const Dialog = Sheet
export const DialogTrigger = SheetTrigger
export const DialogClose = SheetClose

export function DialogContent({ variant = 'dialog', size = 'sm', ...props }: SheetContentProps) {
  return <SheetContent variant={variant} size={size} {...props} />
}

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel: string
  cancelLabel: string
  closeLabel: string
  /** May return a promise; the confirm button shows loading until it settles. */
  onConfirm: () => void | Promise<unknown>
  /** `danger` (delete, remove, leave) gets the tomato button; `primary` a quieter ink one. */
  tone?: 'primary' | 'danger'
  children?: ReactNode
}

/** Asks before doing something consequential. Closes after `onConfirm` resolves. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeLabel,
  onConfirm,
  tone = 'primary',
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        title={title}
        description={description}
        closeLabel={closeLabel}
        variant="auto"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                {cancelLabel}
              </Button>
            </DialogClose>
            <Button
              variant={tone === 'danger' ? 'primary' : 'ink'}
              loading={busy}
              onClick={confirm}
            >
              {confirmLabel}
            </Button>
          </div>
        }
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}
