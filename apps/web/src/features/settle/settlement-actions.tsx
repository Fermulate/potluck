import { deleteSettlement, moneyKeys, type Settlement } from '@potluck/api'
import { can, type GroupRole } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, ConfirmDialog, IconButton, Sheet, SheetContent, toast } from '@potluck/ui'
import { useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { invalidateMoney, moneyErrorMessage } from '@/features/expenses/money-data'

/**
 * The menu on a recorded payment. Deleting it is the server's `delete_settlement`: the payer,
 * the person paid, whoever recorded it, or an owner or admin. There is no restore, so it asks
 * first instead of offering Undo.
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
  const queryClient = useQueryClient()
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const isParty = [settlement.from_user, settlement.to_user, settlement.created_by].includes(
    viewerId,
  )
  if (!can(viewerRole, 'settlement.delete', { isParty })) return null

  const remove = async () => {
    const key = moneyKeys.settlements(settlement.group_id)
    const previous = queryClient.getQueryData<Settlement[]>(key)
    queryClient.setQueryData<Settlement[]>(key, (rows) =>
      rows?.filter((row) => row.id !== settlement.id),
    )
    try {
      await deleteSettlement(supabase, settlement.id)
    } catch (error) {
      if (previous) queryClient.setQueryData(key, previous)
      toast.error(moneyErrorMessage(error))
      return
    }
    toast.success(t('settle.deleted'))
    invalidateMoney(queryClient, settlement.group_id)
  }

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
        onConfirm={remove}
      />
    </>
  )
}
