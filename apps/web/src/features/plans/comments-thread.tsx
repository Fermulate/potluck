import {
  addEventComment,
  planQueries,
  plansKeys,
  type PlanComment,
  type PlanMember,
} from '@potluck/api'
import { formatRelative, t } from '@potluck/i18n'
import { Avatar, IconButton, Skeleton, cn, toast } from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SendHorizontal } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { isSendEnter } from '@/lib/keyboard'
import { supabase } from '@/lib/supabase'
import { planErrorMessage } from './format'

export interface CommentsThreadProps {
  eventId: string
  members: PlanMember[]
  viewerId: string
  timeZone: string
  avatarUrl?: (path: string | null) => string | null
}

/** The event's comment thread. New comments arrive live (see `useEventRealtime`). */
export function CommentsThread({
  eventId,
  members,
  viewerId,
  timeZone,
  avatarUrl,
}: CommentsThreadProps) {
  const queryClient = useQueryClient()
  const { data: comments } = useQuery(planQueries.comments(supabase, eventId))
  const [body, setBody] = useState('')
  const byId = new Map(members.map((m) => [m.userId, m]))
  const key = plansKeys.comments(eventId)

  const send = useMutation({
    mutationFn: (text: string) => addEventComment(supabase, { eventId, body: text }),
    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<PlanComment[]>(key)
      const optimistic: PlanComment = {
        id: `pending-${Date.now()}`,
        author_id: viewerId,
        body: text,
        created_at: new Date().toISOString(),
        event_id: eventId,
      }
      queryClient.setQueryData<PlanComment[]>(key, (rows) => [...(rows ?? []), optimistic])
      return { previous }
    },
    onError: (error, text, context) => {
      queryClient.setQueryData(key, context?.previous)
      setBody(text)
      toast.error(planErrorMessage(error))
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setBody('')
    send.mutate(text)
  }

  return (
    <section aria-labelledby="comments" className="flex flex-col gap-3">
      <h2 id="comments" className="text-xl font-bold tracking-tight">
        {t('events.comments.title')}
      </h2>
      {!comments ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : comments.length === 0 ? (
        <p className="flourish text-xl text-mute">{t('events.comments.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {comments.map((c) => {
            const author = byId.get(c.author_id)
            const mine = c.author_id === viewerId
            return (
              <li
                key={c.id}
                className={cn('flex gap-2.5', c.id.startsWith('pending-') && 'opacity-60')}
              >
                <Avatar
                  name={author?.displayName ?? '?'}
                  seed={c.author_id}
                  src={avatarUrl?.(author?.avatarPath ?? null)}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2 text-xs text-mute">
                    <span className="font-bold text-ink">
                      {mine ? t('common.you') : (author?.displayName ?? '')}
                    </span>
                    <time dateTime={c.created_at}>
                      {formatRelative(c.created_at, { timeZone })}
                    </time>
                  </p>
                  <p
                    className={cn(
                      'mt-1 inline-block rounded-[1rem] rounded-tl-[0.25rem] px-3.5 py-2 text-[0.9375rem] leading-snug break-words whitespace-pre-wrap',
                      mine ? 'bg-ink text-paper' : 'bg-sunken text-ink',
                    )}
                  >
                    {c.body}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <form onSubmit={submit} className="flex items-end gap-2">
        <label className="sr-only" htmlFor={`comment-${eventId}`}>
          {t('events.comments.label')}
        </label>
        <textarea
          id={`comment-${eventId}`}
          value={body}
          rows={1}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (isSendEnter(e)) submit(e)
          }}
          placeholder={t('events.comments.placeholder')}
          className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none rounded-[1.375rem] border border-line-strong bg-card px-4 py-2.5 text-[0.9375rem] text-ink placeholder:text-mute focus-visible:border-ink focus-visible:outline-none"
        />
        <IconButton
          type="submit"
          label={t('events.comments.send')}
          icon={<SendHorizontal />}
          variant="ink"
          disabled={!body.trim()}
        />
      </form>
    </section>
  )
}
