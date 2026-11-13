import type { Settlement } from '@potluck/api'
import { can, type GroupRole } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, ConfirmDialog, IconButton, Sheet, SheetContent } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { MoreHorizontal, PencilLine, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useDeletePayment } from './use-delete-payment'

/**
 * The menu on a recorded payment: edit or delete it. The server's rule (`update_settlement`,
 * `delete_settlement`): the payer, the person paid, whoever recorded it, or an owner or admin.
 * Deleting asks first, then offers Undo.
 */
export function SettlementActions({
  settlement,
  viewerId,
  viewerRole,
  label,
}: {
  settlement: Settlement
  viewerId: string
  viewerRole: GroupRole | undefined
  /** What the payment says in the list, e.g. "You paid Kai $20.00". */
  label: string
}) {
  const deletePayment = useDeletePayment()
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const isParty = [settlement.from_user, settlement.to_user, settlement.created_by].includes(
    viewerId,
  )
  if (!can(viewerRole, 'settlement.delete', { isParty })) return null

  return (
    <>
      <IconButton
        size="sm"
        label={t('settle.actions', { payment: label })}
        icon={<MoreHorizontal />}
        onClick={() => setMenu(true)}
      />
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent title={label} closeLabel={t('common.close')} size="sm">
          <div className="grid gap-2">
            {can(viewerRole, 'settlement.edit', { isParty }) && (
              <Button asChild block variant="secondary">
                <Link
                  to="/payments/$paymentId/edit"
                  params={{ paymentId: settlement.id }}
                  onClick={() => setMenu(false)}
                >
                  <PencilLine aria-hidden className="-ml-1 size-[1.15em]" />
                  {t('settle.edit')}
                </Link>
              </Button>
            )}
            <Button
              block
              variant="danger"
              leadingIcon={<Trash2 />}
              onClick={() => {
                setMenu(false)
                setConfirm(true)
              }}
            >
              {t('settle.delete')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('settle.delete')}
        description={t('settle.deleteConfirm')}
        confirmLabel={t('settle.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        tone="danger"
        onConfirm={() => deletePayment(settlement)}
      />
    </>
  )
}
