import { createGroup, groupKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, Field, Input, Sheet, SheetContent, toast } from '@potluck/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { CurrencyField } from '@/features/me/profile-fields'
import { errorMessage } from '@/lib/errors'
import type { GroupColor } from '@/lib/group-colors'
import { useMyProfile } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { GroupTile } from './group-bits'
import { GROUP_EMOJIS } from './group-emojis'
import { ColorPicker, EmojiPicker } from './group-form-fields'

interface CreateGroupSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'create-group-form'

export function CreateGroupSheet({ open, onOpenChange }: CreateGroupSheetProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: profile } = useMyProfile()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState<string>(GROUP_EMOJIS[0])
  const [color, setColor] = useState<GroupColor>('saffron')
  const [currency, setCurrency] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const chosenCurrency = currency ?? profile?.default_currency ?? 'USD'

  function reset() {
    setName('')
    setEmoji(GROUP_EMOJIS[0])
    setColor('saffron')
    setCurrency(null)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const group = await createGroup(supabase, {
        name,
        emoji,
        color,
        currency: chosenCurrency,
      })
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
      toast.success(t('groups.create.created', { group: group.name }))
      onOpenChange(false)
      reset()
      await navigate({ to: '/groups/$groupId/members', params: { groupId: group.id } })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('groups.create.title')}
        closeLabel={t('common.close')}
        footer={
          <Button
            type="submit"
            form={FORM_ID}
            block
            size="lg"
            loading={busy}
            disabled={!name.trim()}
          >
            {t('groups.create.submit')}
          </Button>
        }
      >
        <form id={FORM_ID} className="grid gap-6 pt-2" onSubmit={onSubmit}>
          <div className="flex items-end gap-4">
            <GroupTile emoji={emoji} color={color} size="lg" />
            <Field label={t('groups.create.nameLabel')} className="flex-1">
              <Input
                required
                autoFocus
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('groups.create.namePlaceholder')}
              />
            </Field>
          </div>
          <EmojiPicker value={emoji} onChange={setEmoji} />
          <ColorPicker value={color} onChange={setColor} />
          <CurrencyField
            label={t('groups.create.currencyLabel')}
            hint={t('groups.create.currencyHint')}
            value={chosenCurrency}
            onChange={setCurrency}
          />
        </form>
      </SheetContent>
    </Sheet>
  )
}
