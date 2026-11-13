import { addPlaceholderMember, createGroup, groupKeys } from '@potluck/api'
import { intlLocale, t } from '@potluck/i18n'
import { Button, Chip, Field, Input, Sheet, SheetContent, toast } from '@potluck/ui'
import { Plus, X } from 'lucide-react'
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
  // People not on Potluck yet, added by name once the group exists.
  const [seat, setSeat] = useState('')
  const [seats, setSeats] = useState<string[]>([])
  const chosenCurrency = currency ?? profile?.default_currency ?? 'USD'

  function reset() {
    setName('')
    setEmoji(GROUP_EMOJIS[0])
    setColor('saffron')
    setCurrency(null)
    setSeat('')
    setSeats([])
  }

  function addSeat() {
    const name = seat.trim()
    if (!name) return
    setSeats((list) => (list.includes(name) ? list : [...list, [...name].slice(0, 80).join('')]))
    setSeat('')
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    let group: Awaited<ReturnType<typeof createGroup>>
    try {
      group = await createGroup(supabase, {
        name,
        emoji,
        color,
        currency: chosenCurrency,
      })
    } catch (error) {
      toast.error(errorMessage(error))
      setBusy(false)
      return
    }
    const typed = seat.trim()
    const notAdded: string[] = []
    for (const name of typed && !seats.includes(typed) ? [...seats, typed] : seats) {
      try {
        await addPlaceholderMember(supabase, { groupId: group.id, displayName: name })
      } catch {
        notAdded.push(name)
      }
    }
    await queryClient.invalidateQueries({ queryKey: groupKeys.all })
    toast.success(t('groups.create.created', { group: group.name }))
    if (notAdded.length > 0) {
      const names = new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(notAdded)
      toast.error(t('people.createGroup.notAdded', { names }))
    }
    onOpenChange(false)
    reset()
    setBusy(false)
    await navigate({ to: '/groups/$groupId/members', params: { groupId: group.id } })
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
          <div className="grid gap-2">
            <Field label={t('people.createGroup.label')} hint={t('people.createGroup.hint')}>
              <div className="flex gap-2">
                <Input
                  maxLength={80}
                  autoComplete="off"
                  className="min-w-0 flex-1"
                  value={seat}
                  onChange={(e) => setSeat(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addSeat()
                    }
                  }}
                  placeholder={t('people.placeholder.namePlaceholder')}
                />
                <Button
                  type="button"
                  size="lg"
                  variant="secondary"
                  leadingIcon={<Plus />}
                  disabled={!seat.trim()}
                  onClick={addSeat}
                >
                  {t('people.createGroup.add')}
                </Button>
              </div>
            </Field>
            {seats.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label={t('people.createGroup.label')}>
                {seats.map((name) => (
                  <li key={name}>
                    <Chip
                      icon={<X aria-hidden />}
                      onClick={() => setSeats((list) => list.filter((n) => n !== name))}
                    >
                      {name}
                      <span className="sr-only"> {t('people.createGroup.remove')}</span>
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
