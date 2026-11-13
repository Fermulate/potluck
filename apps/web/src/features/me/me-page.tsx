import {
  calendarFeedKeys,
  calendarFeedTokenQueryOptions,
  calendarFeedUrl,
  deleteMyAccount,
  fetchCalendarFeedToken,
  meKeys,
  removeAvatarFile,
  updateMyProfile,
  type ProfilePatch,
  type ProfileRow,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  Field,
  Input,
  SegmentedControl,
  Skeleton,
  Switch,
  toast,
} from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Bug,
  CalendarPlus,
  ChevronRight,
  Compass,
  Copy,
  LocateFixed,
  LogOut,
  MessageCircleQuestion,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { AboutSection } from '@/features/account/about-section'
import { LanguageField } from '@/features/account/language-field'
import { SecuritySection } from '@/features/account/security-section'
import { Help } from '@/features/help/help'
import { HELP_PAGES } from '@/features/help/topics'
import { useUnreadCount } from '@/features/notifications/use-notifications'
import { copyText } from '@/features/invites/share'
import { signOut, useUserId } from '@/lib/auth'
import { docsUrl, REPORT_PROBLEM_URL } from '@/lib/docs'
import { errorMessage } from '@/lib/errors'
import { detectTimezone } from '@/lib/locale'
import { avatarSrc, useFlag, useMyProfile } from '@/lib/queries'
import { supabase, supabaseUrl } from '@/lib/supabase'
import { useTheme } from '@/styles/use-theme'
import { AvatarPicker } from './avatar-picker'
import { NotificationPrefs } from './notification-prefs'
import { PaymentMethodsSection } from './payment-methods'
import { CurrencyField, TimezoneField } from './profile-fields'
import { useWebPush } from './use-web-push'

function Section({
  id,
  title,
  help,
  children,
}: {
  id: string
  title: string
  /** A help affordance on the title row. */
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-sm font-bold text-mute">
          {title}
        </h2>
        {help}
      </div>
      <Card padding="roomy" className="grid grid-cols-[minmax(0,1fr)] gap-5">
        {children}
      </Card>
    </section>
  )
}

function useProfilePatch(userId: string) {
  const queryClient = useQueryClient()
  const key = meKeys.profile(userId)
  return useMutation({
    mutationFn: (patch: ProfilePatch) => updateMyProfile(supabase, userId, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ProfileRow>(key)
      queryClient.setQueryData<ProfileRow>(key, (p) => (p ? { ...p, ...patch } : p))
      return { previous }
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error(errorMessage(error))
    },
    onSuccess: (saved) => queryClient.setQueryData(key, saved),
  })
}

function ProfileSection({ profile }: { profile: ProfileRow }) {
  const patch = useProfilePatch(profile.id)
  const [name, setName] = useState(profile.display_name)
  const dirty = name.trim() !== profile.display_name

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      toast.error(t('settings.profile.nameRequired'))
      return
    }
    patch.mutate(
      { display_name: name.trim() },
      { onSuccess: () => toast.success(t('settings.profile.saved')) },
    )
  }

  async function onAvatar(path: string) {
    const old = profile.avatar_path
    await patch.mutateAsync({ avatar_path: path })
    toast.success(t('settings.profile.saved'))
    if (old) void removeAvatarFile(supabase, old).catch(() => undefined)
  }

  return (
    <Section id="me-profile" title={t('settings.profile.title')}>
      <AvatarPicker
        userId={profile.id}
        name={profile.display_name}
        src={avatarSrc(profile.avatar_path)}
        onUploaded={onAvatar}
        label={t('settings.profile.changePhoto')}
      />
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onSubmit}>
        <Field label={t('settings.profile.name')} className="flex-1">
          <Input
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </Field>
        <Button
          type="submit"
          variant={dirty ? 'ink' : 'secondary'}
          className="h-12"
          disabled={!dirty}
          loading={patch.isPending}
        >
          {t('common.save')}
        </Button>
      </form>
    </Section>
  )
}

function PreferencesSection({ profile }: { profile: ProfileRow }) {
  const patch = useProfilePatch(profile.id)
  const { preference, setPreference } = useTheme()
  const device = detectTimezone()
  const save = (change: ProfilePatch) =>
    patch.mutate(change, { onSuccess: () => toast.success(t('settings.preferences.saved')) })

  return (
    <Section id="me-preferences" title={t('settings.preferences.title')}>
      <LanguageField userId={profile.id} />
      <div className="grid gap-2">
        <TimezoneField
          label={t('settings.preferences.timezone')}
          hint={t('settings.preferences.timezoneHint')}
          value={profile.timezone}
          onChange={(timezone) => save({ timezone })}
        />
        {device !== profile.timezone && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            leadingIcon={<LocateFixed />}
            onClick={() => save({ timezone: device })}
          >
            {t('settings.preferences.detectTimezone')}
          </Button>
        )}
      </div>
      <CurrencyField
        label={t('settings.preferences.currency')}
        hint={t('settings.preferences.currencyHint')}
        value={profile.default_currency}
        onChange={(default_currency) => save({ default_currency })}
      />
      <div className="grid gap-1.5">
        <span className="text-sm font-semibold">{t('settings.preferences.theme')}</span>
        <SegmentedControl
          block
          label={t('settings.preferences.theme')}
          value={preference}
          onValueChange={setPreference}
          options={[
            { value: 'system', label: t('settings.preferences.themeSystem'), icon: <Monitor /> },
            { value: 'light', label: t('settings.preferences.themeLight'), icon: <Sun /> },
            { value: 'dark', label: t('settings.preferences.themeDark'), icon: <Moon /> },
          ]}
        />
      </div>
    </Section>
  )
}

function NotificationsSection() {
  const { data: unread = 0 } = useUnreadCount()
  const push = useWebPush()
  const note: Record<typeof push.state, string> = {
    loading: t('settings.notifications.pushHint'),
    unsupported: t('settings.notifications.pushUnsupported'),
    'not-configured': t('settings.notifications.pushNotConfigured'),
    blocked: t('notifications.pushBlocked'),
    off: t('settings.notifications.pushHint'),
    on: t('settings.notifications.pushOn'),
  }
  const usable = push.state === 'on' || push.state === 'off'

  return (
    <Section
      id="me-notifications"
      title={t('settings.notifications.title')}
      help={<Help topic="push" />}
    >
      <Link
        to="/notifications"
        className="-m-2 flex items-center gap-3 rounded-card p-2 transition-colors hover:bg-sunken"
      >
        <span
          aria-hidden
          className="grid size-10 place-items-center rounded-full bg-saffron-soft text-saffron-ink"
        >
          <Bell className="size-5" />
        </span>
        <span className="flex-1 font-semibold">{t('settings.notifications.inbox')}</span>
        {unread > 0 && <Badge tone="tomato">{t('notifications.unread', { count: unread })}</Badge>}
        <ChevronRight aria-hidden className="size-4 text-mute" />
      </Link>
      <Switch
        label={t('settings.notifications.push')}
        description={note[push.state]}
        checked={push.state === 'on'}
        disabled={!usable || push.busy}
        onCheckedChange={async (checked) => {
          try {
            if (checked) {
              const ok = await push.enable()
              if (!ok) return
            } else {
              await push.disable()
            }
          } catch {
            toast.error(t('settings.notifications.pushFailed'))
          }
        }}
      />
      <NotificationPrefs push={push} />
    </Section>
  )
}

function CalendarSection() {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const importOn = useFlag('calendar_import')
  const token = useQuery(calendarFeedTokenQueryOptions(supabase, userId))
  const [confirmReset, setConfirmReset] = useState(false)
  const url = token.data ? calendarFeedUrl(supabaseUrl, token.data) : null
  const webcal = url?.replace(/^https?:\/\//, 'webcal://')

  return (
    <Section
      id="me-calendar"
      title={t('settings.calendar.title')}
      help={<Help topic="calendarFeed" />}
    >
      <div className="grid gap-3">
        <div>
          <p className="font-semibold">{t('settings.calendar.feed')}</p>
          <p className="text-sm text-mute">{t('settings.calendar.feedHint')}</p>
        </div>
        {token.isPending ? (
          <Skeleton className="h-12" />
        ) : url ? (
          <>
            <Input
              readOnly
              value={url}
              aria-label={t('settings.calendar.feed')}
              onFocus={(e) => e.target.select()}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ink"
                leadingIcon={<Copy />}
                onClick={async () => {
                  if (await copyText(url)) toast.success(t('common.copied'))
                }}
              >
                {t('settings.calendar.copyFeed')}
              </Button>
              {webcal && (
                <Button asChild size="sm" variant="secondary">
                  <a href={webcal}>
                    <CalendarPlus aria-hidden className="-ml-1 size-4" />
                    {t('settings.calendar.subscribe')}
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<RefreshCw />}
                onClick={() => setConfirmReset(true)}
              >
                {t('settings.calendar.resetFeed')}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-mute">{errorMessage(token.error)}</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <div>
          <p className="font-semibold">{t('settings.calendar.connect')}</p>
          <p className="text-sm text-mute">{t('settings.calendar.connectHint')}</p>
        </div>
        {!importOn && <Badge tone="saffron">{t('settings.calendar.comingSoon')}</Badge>}
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('settings.calendar.resetFeed')}
        description={t('settings.calendar.resetFeedHint')}
        confirmLabel={t('settings.calendar.resetFeed')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        tone="danger"
        onConfirm={async () => {
          try {
            const next = await fetchCalendarFeedToken(supabase, true)
            queryClient.setQueryData(calendarFeedKeys.token(userId), next)
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
      />
    </Section>
  )
}

function DeleteAccount() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const word = t('account.delete.confirmWord')

  async function onDelete() {
    setBusy(true)
    try {
      await deleteMyAccount(supabase)
      await signOut()
      toast.success(t('account.delete.done'))
      await navigate({ to: '/', replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="danger" leadingIcon={<Trash2 />} onClick={() => setOpen(true)}>
        {t('account.delete.title')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent
          title={t('account.delete.title')}
          description={t('account.delete.warning')}
          closeLabel={t('common.close')}
          variant="auto"
          footer={
            <Button
              block
              variant="primary"
              loading={busy}
              disabled={typed.trim() !== word}
              onClick={onDelete}
            >
              {busy ? t('account.delete.deleting') : t('account.delete.submit')}
            </Button>
          }
        >
          <Field label={t('account.delete.confirmPhrase')} className="pt-2">
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
            />
          </Field>
          <Help topic="deleteAccount" showLabel className="mt-4" />
        </DialogContent>
      </Dialog>
    </>
  )
}

const HELP_ROWS = [
  { id: 'gettingStarted', icon: Compass, href: () => docsUrl(HELP_PAGES.gettingStarted) },
  { id: 'faq', icon: MessageCircleQuestion, href: () => docsUrl(HELP_PAGES.faq) },
  { id: 'troubleshooting', icon: Wrench, href: () => docsUrl(HELP_PAGES.troubleshooting) },
  { id: 'guide', icon: BookOpen, href: () => docsUrl(HELP_PAGES.guide) },
  { id: 'report', icon: Bug, href: () => REPORT_PROBLEM_URL },
] as const

export function HelpSection() {
  return (
    <Section id="me-help" title={t('help.section.title')}>
      <p className="text-sm text-mute">{t('help.section.intro')}</p>
      <ul className="-mx-2 -mb-2 grid gap-0.5">
        {HELP_ROWS.map(({ id, icon: Icon, href }) => (
          <li key={id}>
            <a
              href={href()}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-3 rounded-card p-2 transition-colors hover:bg-sunken"
            >
              <span
                aria-hidden
                className="grid size-9 place-items-center rounded-full bg-sunken text-ink"
              >
                <Icon className="size-[1.125rem]" />
              </span>
              <span className="flex-1 font-semibold">
                {t(`help.section.${id}`)} <span className="sr-only">({t('help.newTab')})</span>
              </span>
              <ArrowUpRight aria-hidden className="size-4 text-mute" />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function AccountSection() {
  const navigate = useNavigate()
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          leadingIcon={<LogOut />}
          onClick={async () => {
            await signOut()
            toast(t('auth.signedOut'))
            await navigate({ to: '/', replace: true })
          }}
        >
          {t('auth.signOut')}
        </Button>
        <DeleteAccount />
      </div>
      <p className="text-sm text-mute">
        {t('settings.about.license')}{' '}
        <a
          href="https://github.com/Fermulate/potluck"
          className="font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4"
          target="_blank"
          rel="noreferrer"
        >
          {t('settings.about.source')}
        </a>
      </p>
    </section>
  )
}

export function MePage() {
  const { data: profile, isPending } = useMyProfile()
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-32 lg:max-w-5xl lg:px-8 lg:pt-10 lg:pb-12">
      <header className="mb-8">
        <h1 className="font-display text-5xl leading-[0.95] sm:text-6xl">{t('settings.title')}</h1>
        <p className="mt-2 text-mute">{t('settings.subtitle')}</p>
      </header>
      {isPending || !profile ? (
        <div className="grid gap-4" aria-hidden>
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        // Two newspaper-style columns on desktop; reading order stays the same as on a phone.
        <div className="grid gap-8 lg:block lg:columns-2 lg:gap-10 lg:[&>*]:mb-8 lg:[&>*]:break-inside-avoid">
          <ProfileSection key={profile.updated_at} profile={profile} />
          <PreferencesSection profile={profile} />
          <PaymentMethodsSection />
          <SecuritySection />
          <NotificationsSection />
          <CalendarSection />
          <HelpSection />
          <AboutSection />
          <AccountSection />
        </div>
      )}
    </div>
  )
}
