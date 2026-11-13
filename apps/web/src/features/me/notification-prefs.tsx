import {
  notificationPrefKeys,
  notificationPrefsQueryOptions,
  setNotificationPref,
  type NotificationCategory,
  type NotificationPref,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import { cn, Skeleton, Switch, toast } from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlarmClock,
  ArrowRightLeft,
  CalendarHeart,
  Mail,
  MessageCircle,
  PencilLine,
  Receipt,
  ScrollText,
  UserPlus,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { useFlag } from '@/lib/queries'
import { supabase } from '@/lib/supabase'

/** Same tiles as the inbox rows, so a setting looks like the notifications it controls. */
const LOOK: Record<NotificationCategory, { icon: ReactNode; tile: string }> = {
  expense_added: { icon: <Receipt />, tile: 'bg-tomato-soft text-tomato-ink' },
  expense_changed: { icon: <PencilLine />, tile: 'bg-tomato-soft text-tomato-ink' },
  payments: { icon: <ArrowRightLeft />, tile: 'bg-olive-soft text-olive-ink' },
  comments: { icon: <MessageCircle />, tile: 'bg-sunken text-ink' },
  groups: { icon: <UserPlus />, tile: 'bg-plum-soft text-plum-ink' },
  plans: { icon: <CalendarHeart />, tile: 'bg-saffron-soft text-saffron-ink' },
  reminders: { icon: <AlarmClock />, tile: 'bg-saffron-soft text-saffron-ink' },
  monthly_summary: { icon: <ScrollText />, tile: 'bg-olive-soft text-olive-ink' },
}

type Channel = 'push' | 'email'
interface Change {
  category: NotificationCategory
  channel: Channel
  on: boolean
}

function useSavePref(userId: string) {
  const queryClient = useQueryClient()
  const key = notificationPrefKeys.mine(userId)
  return useMutation({
    mutationFn: ({ category, channel, on }: Change) =>
      setNotificationPref(supabase, category, { [channel]: on }),
    onMutate: async ({ category, channel, on }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<NotificationPref[]>(key)
      queryClient.setQueryData<NotificationPref[]>(key, (rows) =>
        rows?.map((row) => (row.category === category ? { ...row, [channel]: on } : row)),
      )
      return { previous }
    },
    onError: (_error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error(t('settings.notificationPrefs.failed'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

/**
 * Per type push and email settings, for the whole account (every device). The inbox always gets
 * everything. The email column shows once `app_config.email_notifications` is on.
 */
export function NotificationPrefs() {
  const userId = useUserId()
  const emailOn = useFlag('email_notifications')
  const prefs = useQuery(notificationPrefsQueryOptions(supabase, userId))
  const save = useSavePref(userId)
  const channels: Channel[] = emailOn ? ['push', 'email'] : ['push']
  // A setting with nothing to switch here (the monthly summary is email only) is left out.
  const rows = (prefs.data ?? []).filter((p) => channels.some((c) => p[`${c}_allowed`]))

  return (
    <div className="grid gap-3 border-t border-line pt-5">
      <div className="grid gap-0.5">
        <h3 id="me-notification-prefs" className="font-semibold">
          {t('settings.notificationPrefs.title')}
        </h3>
        <p className="text-sm text-mute">{t('settings.notificationPrefs.hint')}</p>
      </div>
      {prefs.isPending ? (
        <div className="grid gap-3" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : prefs.isError ? (
        <p className="text-sm text-mute">{errorMessage(prefs.error)}</p>
      ) : (
        <div>
          <div
            aria-hidden
            className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-end gap-3 pb-1"
          >
            <span />
            <span />
            <span className="flex gap-3">
              {channels.map((c) => (
                <span key={c} className="w-12 text-center text-xs font-semibold text-mute">
                  {t(`settings.notificationPrefs.${c}`)}
                </span>
              ))}
            </span>
          </div>
          <ul aria-labelledby="me-notification-prefs" className="grid">
            {rows.map((pref) => {
              const look = LOOK[pref.category]
              const label = t(`settings.notificationPrefs.categories.${pref.category}.label`)
              return (
                <li
                  key={pref.category}
                  className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-3"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-9 place-items-center rounded-[0.75rem] [&_svg]:size-[1.125rem]',
                      look.tile,
                    )}
                  >
                    {look.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.9375rem] font-semibold">{label}</span>
                    <span className="block text-sm text-mute">
                      {t(`settings.notificationPrefs.categories.${pref.category}.hint`)}
                    </span>
                  </span>
                  <span className="flex gap-3">
                    {channels.map((channel) =>
                      pref[`${channel}_allowed`] ? (
                        <span key={channel} className="grid w-12 place-items-center">
                          <Switch
                            aria-label={t('settings.notificationPrefs.channel', {
                              category: label,
                              channel: t(`settings.notificationPrefs.${channel}`),
                            })}
                            checked={pref[channel]}
                            onCheckedChange={(on) =>
                              save.mutate({ category: pref.category, channel, on })
                            }
                          />
                        </span>
                      ) : (
                        <span key={channel} aria-hidden className="w-12" />
                      ),
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {!emailOn && (
        <p className="flex items-start gap-2 text-sm text-mute">
          <Mail aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('settings.notificationPrefs.emailSoon')}
        </p>
      )}
    </div>
  )
}
