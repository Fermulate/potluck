import {
  createFriendInvite,
  fetchMyFriendLink,
  myFriendLinkQueryOptions,
  myProfileQueryOptions,
  peopleKeys,
} from '@potluck/api'
import { friendInviteSchema } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, Field, IconButton, Input, Skeleton, toast } from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, HeartHandshake, RefreshCw, Share2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { copyText } from '@/features/invites/share'
import { friendUrl } from '@/lib/app-url'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

async function shareFriendLink(url: string) {
  const data = {
    title: t('people.friendLink.shareTitle'),
    text: t('people.friendLink.shareText', { url }),
    url,
  }
  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data)
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  if (await copyText(url)) toast.success(t('people.friendLink.copied'))
}

/** The viewer's personal friend link: copy, share, or swap it for a new one. */
export function FriendLinkCard() {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const link = useQuery(myFriendLinkQueryOptions(supabase, userId))
  const [copied, setCopied] = useState(false)
  const [rotating, setRotating] = useState(false)
  const url = link.data ? friendUrl(link.data) : null

  async function rotate() {
    setRotating(true)
    try {
      const code = await fetchMyFriendLink(supabase, true)
      queryClient.setQueryData(peopleKeys.friendLink(userId), code)
      toast.success(t('people.friendLink.rotated'))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRotating(false)
    }
  }

  return (
    <section
      aria-labelledby="friend-link-title"
      className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-card border border-line bg-card p-4"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-plum-soft text-plum-ink"
        >
          <HeartHandshake className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="friend-link-title" className="font-semibold">
            {t('people.friendLink.title')}
          </h3>
          {url ? (
            <p className="truncate text-xs text-mute">{url.replace(/^https?:\/\//, '')}</p>
          ) : (
            <span className="mt-1 block">
              <span className="sr-only">{t('people.friendLink.loading')}</span>
              <Skeleton shape="line" className="w-40" />
            </span>
          )}
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          label={t('people.friendLink.rotate')}
          icon={<RefreshCw className={rotating ? 'animate-spin' : undefined} />}
          disabled={!url || rotating}
          onClick={() => void rotate()}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          leadingIcon={copied ? <Check /> : <Copy />}
          disabled={!url}
          onClick={async () => {
            if (url && (await copyText(url))) {
              setCopied(true)
              toast.success(t('people.friendLink.copied'))
              window.setTimeout(() => setCopied(false), 1600)
            }
          }}
        >
          {copied ? t('common.copied') : t('people.friendLink.copy')}
        </Button>
        <Button
          variant="secondary"
          leadingIcon={<Share2 />}
          disabled={!url}
          onClick={() => url && void shareFriendLink(url)}
        >
          {t('people.friendLink.share')}
        </Button>
      </div>
    </section>
  )
}

/**
 * A single-use link only one email can accept, handed to the viewer's own mail app so the
 * invite comes from them.
 */
export function FriendEmailInvite() {
  const userId = useUserId()
  const { data: me } = useQuery(myProfileQueryOptions(supabase, userId))
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = friendInviteSchema.safeParse({ email })
    if (!parsed.success) {
      setError(t('errors.validation.invalidEmail'))
      return
    }
    setBusy(true)
    try {
      const code = await createFriendInvite(supabase, parsed.data.email)
      const name = me?.display_name ?? ''
      const subject = t('people.friendEmail.subject', { name })
      const body = t('people.friendEmail.body', { url: friendUrl(code) })
      window.location.href = `mailto:${encodeURIComponent(parsed.data.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      toast.success(t('people.friendEmail.ready'))
      setEmail('')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Field
        label={t('people.friendEmail.label')}
        hint={t('people.friendEmail.hint')}
        error={error ?? undefined}
      >
        <div className="flex gap-2">
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            className="min-w-0 flex-1"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            placeholder={t('people.friendEmail.placeholder')}
          />
          <Button
            type="submit"
            size="lg"
            variant="secondary"
            loading={busy}
            disabled={!email.trim()}
          >
            {t('people.friendEmail.send')}
          </Button>
        </div>
      </Field>
    </form>
  )
}
