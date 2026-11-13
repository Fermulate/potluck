import {
  acceptFriendInvite,
  avatarUrl,
  friendInvitePreviewQueryOptions,
  groupKeys,
  type FriendInvitePreview,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import { Avatar, Button, Confetti, Skeleton, toast, usePrefersReducedMotion } from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { Wordmark } from '@/features/shell/brand'
import { needsOnboarding, useSession } from '@/lib/auth'
import { errorMessage, isNotFoundError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

function invalidReason(status: FriendInvitePreview['status'] | 'not_found'): string {
  switch (status) {
    case 'expired':
      return t('invites.invalid.expired')
    case 'used_up':
      return t('invites.invalid.used')
    case 'revoked':
      return t('invites.invalid.revoked')
    default:
      return t('invites.invalid.notFound')
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60dvh] bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--pl-plum)_28%,transparent),transparent_65%)]"
      />
      <main
        id="main"
        className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-6 pb-10"
      >
        <Link to="/" className="self-center rounded-pill" aria-label={t('app.name')}>
          <Wordmark />
        </Link>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
          {children}
        </div>
      </main>
    </div>
  )
}

/** A friend link: the inviter's face, one tap to become friends. */
export function FriendJoinPage({ code }: { code: string }) {
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const reduced = usePrefersReducedMotion()
  const preview = useQuery(
    friendInvitePreviewQueryOptions(supabase, code, session?.user.id ?? null),
  )
  const [joining, setJoining] = useState(false)
  const [burst, setBurst] = useState(0)
  const here = `/friend/${code}`

  async function accept() {
    if (!preview.data) return
    setJoining(true)
    try {
      const friendId = await acceptFriendInvite(supabase, code)
      setBurst((n) => n + 1)
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
      toast.success(t('people.friendJoin.welcome', { name: preview.data.name ?? '' }))
      window.setTimeout(
        () => void navigate({ to: '/friends/$friendId', params: { friendId }, replace: true }),
        reduced ? 0 : 650,
      )
    } catch (error) {
      toast.error(errorMessage(error))
      setJoining(false)
      void preview.refetch()
    }
  }

  if (preview.isPending) {
    return (
      <Frame>
        <Skeleton shape="circle" className="size-28" />
        <Skeleton shape="line" className="h-10 w-56" />
        <Skeleton shape="line" className="w-40" />
      </Frame>
    )
  }

  if (!preview.data && preview.isError && !isNotFoundError(preview.error)) {
    return (
      <Frame>
        <span aria-hidden className="text-7xl">
          📡
        </span>
        <h1 className="flourish text-4xl leading-tight">{t('invites.join.loadFailedTitle')}</h1>
        <p className="max-w-xs text-mute">{t('invites.join.loadFailed')}</p>
        <Button loading={preview.isFetching} onClick={() => void preview.refetch()}>
          {t('common.retry')}
        </Button>
      </Frame>
    )
  }

  const status = preview.data?.status ?? 'not_found'
  if (!preview.data || status !== 'valid') {
    return (
      <Frame>
        <span aria-hidden className="text-7xl">
          🧊
        </span>
        <h1 className="flourish text-4xl leading-tight">{t('people.friendJoin.invalidTitle')}</h1>
        <p className="max-w-xs text-mute">{invalidReason(status)}</p>
        <Button asChild variant="secondary">
          <Link to={session ? '/home' : '/'}>{t('invites.invalid.home')}</Link>
        </Button>
      </Frame>
    )
  }

  const inviter = { ...preview.data, name: preview.data.name ?? '' }
  return (
    <Frame>
      <Confetti fire={burst} origin={{ x: 0.5, y: 0.3 }} haptic />
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: 10 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 16 }}
      >
        <Avatar
          name={inviter.name}
          src={avatarUrl(supabase, inviter.avatar_path)}
          size="xl"
          className="size-28 text-4xl shadow-raised sm:size-32"
        />
      </motion.div>
      <div className="grid gap-3">
        <h1 className="font-display text-5xl leading-[0.95] text-balance">
          {t('people.friendJoin.title', { name: inviter.name })}
        </h1>
        <p className="text-[0.9375rem] text-pretty">{t('people.friendJoin.body')}</p>
      </div>

      <div className="mt-2 grid w-full gap-3">
        {inviter.is_self || inviter.is_friend ? (
          <>
            <p className="font-semibold">
              {inviter.is_self
                ? t('people.friendJoin.self')
                : t('people.friendJoin.already', { name: inviter.name })}
            </p>
            <Button asChild size="lg" block>
              <Link to="/friends">{t('people.friendJoin.open')}</Link>
            </Button>
          </>
        ) : session && !needsOnboarding(session) ? (
          <Button size="lg" block loading={joining} onClick={() => void accept()}>
            {t('people.friendJoin.accept', { name: inviter.name })}
          </Button>
        ) : session ? (
          <Button asChild size="lg" block>
            <Link to="/welcome" search={{ redirect: here }}>
              {t('common.continue')}
            </Link>
          </Button>
        ) : (
          <>
            <Button asChild size="lg" block>
              <Link to="/sign-up" search={{ redirect: here }}>
                {t('people.friendJoin.signUp')}
              </Link>
            </Button>
            <Button asChild variant="ghost" block>
              <Link to="/sign-in" search={{ redirect: here }}>
                {t('people.friendJoin.signIn')}
              </Link>
            </Button>
          </>
        )}
      </div>
    </Frame>
  )
}
