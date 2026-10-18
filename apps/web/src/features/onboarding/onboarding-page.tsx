import { avatarUrl, meKeys, myProfileQueryOptions, updateMyProfile } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, Field, Input, Skeleton, toast } from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Link2, Plus } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AvatarPicker } from '@/features/me/avatar-picker'
import { CurrencyField, TimezoneField } from '@/features/me/profile-fields'
import { Wordmark } from '@/features/shell/brand'
import { errorMessage } from '@/lib/errors'
import { detectTimezone, guessCurrency } from '@/lib/locale'
import { supabase } from '@/lib/supabase'

function Steps({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-pill transition-all duration-300 ${i < step ? 'w-8 bg-tomato' : 'w-4 bg-line-strong'}`}
          />
        ))}
      </div>
      <span className="text-sm font-semibold text-mute">{t('onboarding.step', { step, total })}</span>
    </div>
  )
}

function ChoiceCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: ReactNode
  title: string
  body?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-card border border-line bg-card p-4 text-left transition-[transform,border-color] duration-150 hover:border-ink/30 active:scale-[0.99]"
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-[0.875rem] bg-saffron-soft text-saffron-ink [&_svg]:size-6">
        {icon}
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        {body && <span className="mt-0.5 block text-sm text-mute">{body}</span>}
      </span>
    </button>
  )
}

/**
 * First run after sign up: name, face, time zone and currency, then a nudge to start or join a
 * group. Clears the `needs_onboarding` flag on the auth user when the profile is saved.
 */
export function OnboardingPage({ userId, redirect }: { userId: string; redirect: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: profile, isPending } = useQuery(myProfileQueryOptions(supabase, userId))
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [avatarPath, setAvatarPath] = useState<string | null>(null)
  const [timezone, setTimezone] = useState(detectTimezone)
  const [currency, setCurrency] = useState(guessCurrency)
  const [busy, setBusy] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [showJoin, setShowJoin] = useState(false)

  useEffect(() => {
    if (!profile) return
    setName((n) => n || profile.display_name)
    setAvatarPath((p) => p ?? profile.avatar_path)
  }, [profile])

  const goingSomewhere = redirect !== '/home'

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const saved = await updateMyProfile(supabase, userId, {
        display_name: name.trim(),
        avatar_path: avatarPath,
        timezone,
        default_currency: currency,
      })
      queryClient.setQueryData(meKeys.profile(userId), saved)
      const { error } = await supabase.auth.updateUser({ data: { needs_onboarding: false } })
      if (error) throw error
      if (goingSomewhere) {
        await navigate({ href: redirect, replace: true })
      } else {
        setStep(2)
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function joinFromLink(event: FormEvent) {
    event.preventDefault()
    const code = inviteLink.trim().match(/(?:join\/)?([A-Za-z0-9_-]{10,64})\/?$/)?.[1]
    if (!code) {
      toast.error(t('invites.invalid.notFound'))
      return
    }
    void navigate({ to: '/join/$code', params: { code } })
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-6 pb-10">
      <Wordmark />
      <div className="flex flex-1 flex-col justify-center gap-7 py-10">
        <Steps step={step} total={goingSomewhere ? 1 : 2} />
        {step === 1 ? (
          <>
            <header>
              <h1 className="font-display text-[2.75rem] leading-none">
                {t('onboarding.profile.title')}
              </h1>
              <p className="mt-3 text-mute">{t('onboarding.profile.body')}</p>
            </header>
            {isPending ? (
              <div className="grid gap-4">
                <Skeleton shape="circle" className="size-20" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : (
              <form className="grid gap-5" onSubmit={saveProfile}>
                <AvatarPicker
                  userId={userId}
                  name={name}
                  src={avatarUrl(supabase, avatarPath)}
                  onUploaded={setAvatarPath}
                />
                <Field label={t('onboarding.profile.nameLabel')}>
                  <Input
                    required
                    maxLength={80}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('auth.fields.namePlaceholder')}
                  />
                </Field>
                <TimezoneField
                  value={timezone}
                  onChange={setTimezone}
                  hint={t('onboarding.profile.timezoneHint')}
                />
                <CurrencyField
                  value={currency}
                  onChange={setCurrency}
                  hint={t('onboarding.profile.currencyHint')}
                />
                <Button type="submit" size="lg" block loading={busy} disabled={!name.trim()}>
                  {t('onboarding.profile.save')}
                </Button>
              </form>
            )}
          </>
        ) : (
          <>
            <header>
              <h1 className="font-display text-[2.75rem] leading-none">
                {t('onboarding.firstGroup.title')}
              </h1>
              <p className="mt-3 text-mute">{t('onboarding.firstGroup.body')}</p>
            </header>
            <div className="grid gap-3">
              <ChoiceCard
                icon={<Plus />}
                title={t('onboarding.firstGroup.create')}
                onClick={() => void navigate({ to: '/groups', search: { new: true } })}
              />
              <ChoiceCard
                icon={<Link2 />}
                title={t('onboarding.firstGroup.join')}
                onClick={() => setShowJoin(true)}
              />
              {showJoin && (
                <form className="flex gap-2" onSubmit={joinFromLink}>
                  <Field label={t('invites.linkLabel')} hideLabel className="flex-1">
                    <Input
                      autoFocus
                      value={inviteLink}
                      onChange={(e) => setInviteLink(e.target.value)}
                      placeholder="https://.../join/..."
                    />
                  </Field>
                  <Button type="submit" variant="ink" size="lg" className="h-12">
                    {t('common.continue')}
                  </Button>
                </form>
              )}
            </div>
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => void navigate({ to: '/home', replace: true })}
            >
              {t('onboarding.firstGroup.skip')}
            </Button>
          </>
        )}
      </div>
    </main>
  )
}
