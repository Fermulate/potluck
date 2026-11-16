import type { Settlement } from '@potluck/api'
import { can, type GroupRole } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, ConfirmDialog, IconButton, Sheet, SheetContent } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { MoreHorizontal, PencilLine, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { mayEditPayment } from './payment-rules'
import { useDeletePayment } from './use-delete-payment'

/**
 * The menu on a recorded payment: edit or delete it. The server's rule (`update_settlement`,
 * `delete_settlement`): the payer, the person paid, whoever recorded it, or an owner or admin.
 * Edit follows `mayEditPayment`, the rule behind the edit route. An archived group is read only,
 * so it has no menu. Deleting asks first, then offers Undo.
 */
export function SettlementActions({
  settlement,
  viewerId,
  viewerRole,
  label,
  archived,
  blockedInTab = false,
}: {
  settlement: Settlement
  viewerId: string
  viewerRole: GroupRole | undefined
  /** What the payment says in the list, e.g. "You paid Kai $20.00". */
  label: string
  /** The group is archived: nothing here may change. */
  archived: boolean
  /**
   * The viewer is the blocked side of this 1:1 tab (`useBlockedInTab`; undefined while it is
   * being checked): they may change only the payments they recorded, so the menu waits.
   */
  blockedInTab?: boolean | undefined
}) {
  const deletePayment = useDeletePayment()
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const isParty = [settlement.from_user, settlement.to_user, settlement.created_by].includes(
    viewerId,
  )
  if (archived) return null
  if (blockedInTab !== false && settlement.created_by !== viewerId) return null
  if (!can(viewerRole, 'settlement.delete', { isParty })) return null
  const mayEdit =
    mayEditPayment(settlement, { viewerId, role: viewerRole, blockedInTab, archived }) === true

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
            {mayEdit && (
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
