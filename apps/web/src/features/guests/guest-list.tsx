import { guestQueries, type EventGuest } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Badge, Card, IconButton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { UserRound, X } from 'lucide-react'
import { useId } from 'react'
import { supabase } from '@/lib/supabase'

/** People who answered through a guest link, tagged, with remove for whoever may. */
export function GuestList({
  guests,
  onRemove,
}: {
  guests: readonly EventGuest[]
  /** Shown as a remove button per guest when given. */
  onRemove?: (guest: EventGuest) => void
}) {
  const id = useId()
  if (guests.length === 0) return null
  return (
    <section aria-labelledby={`${id}-guests`} className="flex flex-col gap-2">
      <h3 id={`${id}-guests`} className="text-sm font-bold text-mute">
        {t('guests.panel.answered', { count: guests.length })}
      </h3>
      <ul className="flex flex-col divide-y divide-line">
        {guests.map((guest) => (
          <li key={guest.id} className="flex min-h-11 items-center gap-2.5 py-1.5">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-mute"
            >
              <UserRound className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {guest.display_name}
            </span>
            <Badge tone="neutral">{t('guests.tag')}</Badge>
            {onRemove && (
              <IconButton
                size="sm"
                variant="ghost"
                label={t('guests.panel.remove', { name: guest.display_name })}
                icon={<X />}
                onClick={() => onRemove(guest)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Once a plan has a time, the record of who answered as a guest stays on it (links are closed,
 * so there is nothing else to manage). Renders nothing when nobody did.
 */
export function GuestAnswers({ eventId }: { eventId: string }) {
  const { data } = useQuery(guestQueries.guests(supabase, eventId))
  if (!data || data.length === 0) return null
  return (
    <Card className="flex flex-col gap-2">
      <GuestList guests={data} />
    </Card>
  )
}
