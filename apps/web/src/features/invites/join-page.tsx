import {
  acceptInvite,
  groupKeys,
  invitePreviewQueryOptions,
  type InvitePreview,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import {
  AvatarStack,
  Button,
  Confetti,
  Skeleton,
  toast,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { GroupTile } from '@/features/groups/group-bits'
import { Wordmark } from '@/features/shell/brand'
import { needsOnboarding, useSession } from '@/lib/auth'
import { errorMessage, isNotFoundError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

function namesLine(preview: InvitePreview): string | null {
  const names = preview.first_names.slice(0, 3)
  if (names.length === 0) return null
  const others = preview.member_count - names.length
  const list =
    others > 0
      ? t('common.nameAndOthers', { name: names.join(', '), count: others })
      : names.length === 1
        ? names[0]!
        : `${names.slice(0, -1).join(', ')} ${t('common.and')} ${names[names.length - 1]}`
  return preview.member_count === 1
    ? t('invites.join.whoIsInOne', { names: list })
    : t('invites.join.whoIsIn', { names: list })
}

function invalidReason(status: InvitePreview['status'] | 'not_found'): string {
  switch (status) {
    case 'expired':
      return t('invites.invalid.expired')
    case 'used_up':
      return t('invites.invalid.used')
    case 'revoked':
      return t('invites.invalid.revoked')
    case 'archived':
      return t('invites.invalid.archived')
    case 'blocked':
      return t('invites.invalid.blocked')
    default:
      return t('invites.invalid.notFound')
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60dvh] bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--pl-saffron)_35%,transparent),transparent_65%)]"
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

/** Signature moment: big emoji, the faces already at the table, one tap to sit down. */
export function JoinPage({ code }: { code: string }) {
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const reduced = usePrefersReducedMotion()
  const preview = useQuery(invitePreviewQueryOptions(supabase, code))
  const [joining, setJoining] = useState(false)
  const [burst, setBurst] = useState(0)
  const here = `/join/${code}`

  async function join() {
    if (!preview.data) return
    setJoining(true)
    try {
      const groupId = await acceptInvite(supabase, code)
      setBurst((n) => n + 1)
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
      toast.success(t('invites.join.welcome', { group: preview.data.name }))
      window.setTimeout(
        () => void navigate({ to: '/groups/$groupId', params: { groupId }, replace: true }),
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
        <Skeleton className="size-28 rounded-[1.75rem]" />
        <Skeleton shape="line" className="h-10 w-56" />
        <Skeleton shape="line" className="w-40" />
      </Frame>
    )
  }

  // A dropped connection is not a dead invite: offer a retry instead of "gone cold".
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
        <h1 className="flourish text-4xl leading-tight">{t('invites.invalid.title')}</h1>
        <p className="max-w-xs text-mute">{invalidReason(status)}</p>
        <Button asChild variant="secondary">
          <Link to={session ? '/home' : '/'}>{t('invites.invalid.home')}</Link>
        </Button>
      </Frame>
    )
  }

  const group = preview.data
  // Only the first few names are public; pad so the stack counts everyone.
  const faces = Array.from(
    { length: Math.max(group.member_count, group.first_names.length) },
    (_, i) => {
      const name = group.first_names[i] ?? '?'
      return { id: `${group.group_id}-${i}`, name }
    },
  )
  const line = namesLine(group)
  const host = group.first_names[0]

  return (
    <Frame>
      <Confetti fire={burst} origin={{ x: 0.5, y: 0.3 }} haptic />
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -16 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 16 }}
      >
        <GroupTile
          emoji={group.emoji}
          color={group.color}
          size="xl"
          className="shadow-raised sm:size-36 sm:text-[5rem]"
        />
      </motion.div>
      <div className="grid gap-3">
        <p className="flourish text-2xl text-mute">{t('invites.join.title')}</p>
        <h1 className="font-display text-5xl leading-[0.95] sm:text-6xl">{group.name}</h1>
        {host && <p className="text-[0.9375rem]">{t('invites.join.body', { name: host })}</p>}
      </div>
      <div className="flex flex-col items-center gap-2">
        <AvatarStack people={faces} max={5} size="lg" animate label={line ?? undefined} />
        {line && <p className="max-w-xs text-sm text-mute">{line}</p>}
      </div>

      <div className="mt-2 grid w-full gap-3">
        {group.is_member ? (
          <>
            <p className="font-semibold">
              {t('invites.join.alreadyMember', { group: group.name })}
            </p>
            <Button asChild size="lg" block>
              <Link to="/groups/$groupId" params={{ groupId: group.group_id }}>
                {t('invites.join.open')}
              </Link>
            </Button>
          </>
        ) : session && !needsOnboarding(session) ? (
          <Button size="lg" block loading={joining} onClick={join}>
            {t('invites.join.accept', { group: group.name })}
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
                {t('invites.join.signUpToJoin')}
              </Link>
            </Button>
            <Button asChild variant="ghost" block>
              <Link to="/sign-in" search={{ redirect: here }}>
                {t('invites.join.signInToJoin')}
              </Link>
            </Button>
          </>
        )}
      </div>
    </Frame>
  )
}
