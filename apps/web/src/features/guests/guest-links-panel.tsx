import {
  createGuestLink,
  guestKeys,
  guestQueries,
  plansKeys,
  removeGuestAnswer,
  revokeGuestLink,
  type EventGuest,
  type GuestLink,
  type GuestLinkTtl,
  type PlanMember,
} from '@potluck/api'
import { can } from '@potluck/core'
import { formatDate, formatTime, t } from '@potluck/i18n'
import {
  Badge,
  Button,
  Card,
  cn,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  Sheet,
  SheetContent,
  Skeleton,
  toast,
} from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, Link2Off, Share2 } from 'lucide-react'
import { useState } from 'react'
import { Help } from '@/features/help/help'
import { copyText } from '@/features/invites/share'
import { planErrorMessage } from '@/features/plans/format'
import { guestUrl } from '@/lib/app-url'
import { supabase } from '@/lib/supabase'
import { GuestList } from './guest-list'
import { parseGuestCap, shareGuestLink } from './share'

type CapChoice = '5' | '10' | '25' | 'custom'

const TTLS: { value: GuestLinkTtl; label: () => string }[] = [
  { value: '24h', label: () => t('guests.create.expiry.day') },
  { value: '7d', label: () => t('guests.create.expiry.week') },
  { value: '30d', label: () => t('guests.create.expiry.month') },
]

export interface GuestLinksPanelProps {
  event: { id: string; title: string; created_by: string | null }
  /** The viewer's membership, for who may revoke and remove. */
  viewer: PlanMember | undefined
  timeZone: string
}

/**
 * Guest links on a polling plan: make one (expiry and a guest cap), copy, share or turn it off,
 * and see who answered as a guest, with remove for the organizer and admins.
 */
export function GuestLinksPanel({ event, viewer, timeZone }: GuestLinksPanelProps) {
  const queryClient = useQueryClient()
  const linksQ = useQuery(guestQueries.links(supabase, event.id))
  const guestsQ = useQuery(guestQueries.guests(supabase, event.id))
  const [creating, setCreating] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)
  const [removing, setRemoving] = useState<EventGuest | null>(null)
  const [revoking, setRevoking] = useState<GuestLink | null>(null)
  const organizes = !!viewer && event.created_by === viewer.userId
  const canRemove = can(viewer?.role, 'guest.remove', { isCreator: organizes })
  const key = guestKeys.links(event.id)

  const revoke = useMutation({
    mutationFn: (link: GuestLink) => revokeGuestLink(supabase, link.id),
    onMutate: async (link) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<GuestLink[]>(key)
      queryClient.setQueryData<GuestLink[]>(key, (rows) => rows?.filter((r) => r.id !== link.id))
      return { previous }
    },
    onError: (error, _link, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error(planErrorMessage(error))
    },
    onSuccess: () => toast(t('guests.panel.revoked')),
  })

  const remove = useMutation({
    mutationFn: (guest: EventGuest) => removeGuestAnswer(supabase, guest.id),
    onSuccess: (_data, guest) => {
      toast(t('guests.panel.removed', { name: guest.display_name }))
      void queryClient.invalidateQueries({ queryKey: guestKeys.guests(event.id) })
      void queryClient.invalidateQueries({ queryKey: guestKeys.slots(event.id) })
      void queryClient.invalidateQueries({ queryKey: plansKeys.bestSlots(event.id) })
    },
    onError: (error) => toast.error(planErrorMessage(error)),
  })

  const links = linksQ.data
  const guests = guestsQ.data ?? []
  const usage = (link: GuestLink) => guests.filter((g) => g.link_id === link.id).length

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-bold">
          {t('guests.panel.title')}
          <Help topic="guestLinks" />
        </h2>
        {links && links.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Link2 />}
            onClick={() => setCreating(true)}
          >
            {t('guests.panel.newLink')}
          </Button>
        )}
      </div>

      {linksQ.isError || guestsQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-mute">{t('guests.panel.loadFailed')}</p>
          <Button
            size="sm"
            variant="secondary"
            loading={linksQ.isFetching || guestsQ.isFetching}
            onClick={() => {
              void linksQ.refetch()
              void guestsQ.refetch()
            }}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : !links ? (
        <Skeleton className="h-20" />
      ) : links.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-pretty text-mute">{t('guests.panel.intro')}</p>
          <Button variant="secondary" leadingIcon={<Link2 />} onClick={() => setCreating(true)}>
            {t('guests.panel.share')}
          </Button>
        </div>
      ) : (
        <ul aria-label={t('guests.panel.links')} className="flex flex-col gap-2">
          {links.map((link) => (
            <GuestLinkRow
              key={link.id}
              link={link}
              used={usage(link)}
              fresh={link.id === fresh}
              eventTitle={event.title}
              timeZone={timeZone}
              canRevoke={can(viewer?.role, 'guestLink.revoke', {
                isCreator: organizes || (!!viewer && link.created_by === viewer.userId),
              })}
              onRevoke={() => setRevoking(link)}
            />
          ))}
        </ul>
      )}

      <GuestList guests={guests} onRemove={canRemove ? setRemoving : undefined} />

      <CreateGuestLinkSheet
        open={creating}
        onOpenChange={setCreating}
        eventId={event.id}
        onCreated={(link) => {
          queryClient.setQueryData<GuestLink[]>(key, (rows) => [link, ...(rows ?? [])])
          setFresh(link.id)
        }}
      />

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        tone="danger"
        title={t('guests.panel.revokeTitle')}
        description={t('guests.panel.revokeConfirm')}
        confirmLabel={t('guests.panel.turnOff')}
        cancelLabel={t('common.back')}
        closeLabel={t('common.close')}
        onConfirm={async () => {
          if (revoking) await revoke.mutateAsync(revoking)
        }}
      />

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        tone="danger"
        title={t('guests.panel.removeTitle')}
        description={t('guests.panel.removeConfirm', { name: removing?.display_name ?? '' })}
        confirmLabel={t('common.remove')}
        cancelLabel={t('common.back')}
        closeLabel={t('common.close')}
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing)
        }}
      />
    </Card>
  )
}

function GuestLinkRow({
  link,
  used,
  fresh,
  eventTitle,
  timeZone,
  canRevoke,
  onRevoke,
}: {
  link: GuestLink
  used: number
  fresh: boolean
  eventTitle: string
  timeZone: string
  canRevoke: boolean
  onRevoke: () => void
}) {
  const [copied, setCopied] = useState(false)
  const url = guestUrl(link.code)
  const full = used >= link.max_guests
  const when = `${formatDate(link.expires_at, { timeZone, style: 'weekday' })}, ${formatTime(link.expires_at, { timeZone })}`
  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-[0.875rem] border p-3 transition-colors duration-500',
        fresh ? 'border-saffron bg-saffron-soft/50' : 'border-line',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-saffron-soft text-saffron-ink"
        >
          <Link2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{url.replace(/^https?:\/\//, '')}</p>
          <p className="text-xs text-pretty text-mute">
            <span className="tabular">
              {t('guests.panel.usage', { used, max: link.max_guests })}
            </span>
            {', '}
            {t('guests.panel.closes', { when })}
          </p>
        </div>
        {full && <Badge tone="tomato">{t('guests.panel.full')}</Badge>}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={copied ? <Check /> : <Copy />}
          onClick={async () => {
            if (await copyText(url)) {
              setCopied(true)
              toast.success(t('guests.panel.copied'))
              window.setTimeout(() => setCopied(false), 1600)
            }
          }}
        >
          {copied ? t('common.copied') : t('guests.panel.copy')}
        </Button>
        <IconButton
          size="sm"
          variant="ghost"
          label={t('guests.panel.shareLink')}
          icon={<Share2 />}
          onClick={() => void shareGuestLink(eventTitle, link.code)}
        />
        {canRevoke && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-tomato-ink"
            leadingIcon={<Link2Off />}
            aria-label={t('guests.panel.revoke', { code: link.code })}
            onClick={onRevoke}
          >
            {t('guests.panel.turnOff')}
          </Button>
        )}
      </div>
    </li>
  )
}

function CreateGuestLinkSheet({
  open,
  onOpenChange,
  eventId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string
  onCreated: (link: GuestLink) => void
}) {
  const [ttl, setTtl] = useState<GuestLinkTtl>('7d')
  const [cap, setCap] = useState<CapChoice>('10')
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const maxGuests = cap === 'custom' ? parseGuestCap(custom) : Number(cap)

  const create = useMutation({
    mutationFn: (max: number) => createGuestLink(supabase, { eventId, ttl, maxGuests: max }),
    onSuccess: (link) => {
      onCreated(link)
      toast.success(t('guests.panel.created'))
      onOpenChange(false)
    },
    onError: (error) => toast.error(planErrorMessage(error)),
  })

  const submit = () => {
    if (maxGuests === null) {
      setCustomError(t('guests.create.capInvalid'))
      return
    }
    create.mutate(maxGuests)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('guests.create.title')}
        description={t('guests.create.description')}
        closeLabel={t('common.close')}
        footer={
          <Button
            block
            size="lg"
            leadingIcon={<Link2 />}
            loading={create.isPending}
            onClick={submit}
          >
            {t('guests.create.submit')}
          </Button>
        }
      >
        <div className="flex flex-col gap-5 pt-2">
          <div className="grid gap-1.5">
            <span className="text-sm font-semibold">{t('guests.create.expiresLabel')}</span>
            <SegmentedControl<GuestLinkTtl>
              block
              label={t('guests.create.expiresLabel')}
              value={ttl}
              onValueChange={setTtl}
              options={TTLS.map((o) => ({ value: o.value, label: o.label() }))}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-semibold">{t('guests.create.capLabel')}</span>
            <SegmentedControl<CapChoice>
              block
              label={t('guests.create.capLabel')}
              value={cap}
              onValueChange={(next) => {
                setCap(next)
                setCustomError(null)
              }}
              options={[
                { value: '5', label: '5' },
                { value: '10', label: '10' },
                { value: '25', label: '25' },
                { value: 'custom', label: t('guests.create.capCustom') },
              ]}
            />
          </div>
          {cap === 'custom' && (
            <Field
              label={t('guests.create.capCustomLabel')}
              hint={t('guests.create.capCustomHint')}
              error={customError ?? undefined}
            >
              <Input
                inputMode="numeric"
                autoComplete="off"
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))
                  setCustomError(null)
                }}
              />
            </Field>
          )}
          {maxGuests !== null && (
            <p className="text-sm text-mute">
              {t('guests.create.summary', {
                max: maxGuests,
                expiry: TTLS.find((o) => o.value === ttl)!.label(),
              })}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
