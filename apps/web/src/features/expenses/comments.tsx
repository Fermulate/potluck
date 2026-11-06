import {
  addExpenseComment,
  deleteExpenseComment,
  moneyKeys,
  moneyQueries,
  type ExpenseComment,
} from '@potluck/api'
import { formatRelative, t } from '@potluck/i18n'
import { Avatar, IconButton, Skeleton, toast } from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SendHorizontal, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useUserId } from '@/lib/auth'
import { isSendEnter } from '@/lib/keyboard'
import { supabase } from '@/lib/supabase'
import { avatarUrl, moneyErrorMessage, useNameOf, usePeople, useTimeZone } from './money-data'

/** Comment thread on an expense. New comments show up instantly and for everyone (realtime). */
export function ExpenseComments({
  expenseId,
  canModerate,
}: {
  expenseId: string
  canModerate: boolean
}) {
  const me = useUserId()
  const people = usePeople()
  const nameOf = useNameOf()
  const timeZone = useTimeZone()
  const queryClient = useQueryClient()
  const key = moneyKeys.comments(expenseId)
  const { data, isPending } = useQuery(moneyQueries.comments(supabase, expenseId))
  const [body, setBody] = useState('')

  const send = useMutation({
    mutationFn: (text: string) => addExpenseComment(supabase, { expenseId, body: text }),
    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ExpenseComment[]>(key)
      const optimistic: ExpenseComment = {
        id: `pending-${Date.now()}`,
        expense_id: expenseId,
        author_id: me,
        body: text,
        created_at: new Date().toISOString(),
      }
      queryClient.setQueryData<ExpenseComment[]>(key, (rows) => [...(rows ?? []), optimistic])
      setBody('')
      return { previous, text }
    },
    onError: (error, _text, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
      if (ctx) setBody(ctx.text)
      toast.error(moneyErrorMessage(error))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteExpenseComment(supabase, id),
    onMutate: async (id) => {
      const previous = queryClient.getQueryData<ExpenseComment[]>(key)
      queryClient.setQueryData<ExpenseComment[]>(key, (rows) => rows?.filter((c) => c.id !== id))
      return { previous }
    },
    onError: (error, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
      toast.error(moneyErrorMessage(error))
    },
    onSuccess: () => toast(t('expenses.comments.deleted')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = body.trim()
    if (text) send.mutate(text)
  }

  const count = data?.length ?? 0
  return (
    <section aria-labelledby="comments-title" className="flex flex-col gap-4">
      <h2 id="comments-title" className="font-display text-2xl">
        {t('expenses.comments.title')}
        {count > 0 && (
          <span className="ml-2 font-sans tabular text-sm font-semibold text-mute">{count}</span>
        )}
      </h2>
      {isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-14" />
          <Skeleton className="h-14 w-4/5" />
        </div>
      ) : (
        count > 0 && (
          <ol className="flex flex-col gap-3" aria-live="polite">
            {data!.map((c) => {
              const author = people.get(c.author_id)
              const mine = c.author_id === me
              return (
                <li key={c.id} className="group flex items-start gap-2.5">
                  <Avatar
                    name={author?.display_name ?? nameOf(c.author_id)}
                    seed={c.author_id}
                    src={avatarUrl(author?.avatar_path)}
                    size="sm"
                  />
                  <div className="rounded-tl-md min-w-0 flex-1 rounded-[1.125rem] bg-sunken px-3.5 py-2.5">
                    <p className="flex items-baseline gap-2 text-sm">
                      <span className="font-bold">{nameOf(c.author_id)}</span>
                      <time dateTime={c.created_at} className="text-xs text-mute">
                        {formatRelative(c.created_at, { timeZone })}
                      </time>
                    </p>
                    <p className="mt-0.5 text-[0.9375rem] break-words whitespace-pre-wrap">
                      {c.body}
                    </p>
                  </div>
                  {(mine || canModerate) && !c.id.startsWith('pending-') && (
                    <IconButton
                      size="sm"
                      label={t('common.delete')}
                      icon={<Trash2 />}
                      className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => remove.mutate(c.id)}
                    />
                  )}
                </li>
              )
            })}
          </ol>
        )
      )}
      <form onSubmit={submit} className="flex items-end gap-2">
        <label htmlFor="comment-body" className="sr-only">
          {t('expenses.comments.placeholder')}
        </label>
        <textarea
          id="comment-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (isSendEnter(e)) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder={t('expenses.comments.placeholder')}
          maxLength={2000}
          rows={1}
          className="field-sizing-content max-h-40 min-h-12 flex-1 resize-none rounded-[1.5rem] border border-line-strong bg-card px-4 py-3 text-base text-ink placeholder:text-mute/80 focus:border-ink focus-visible:outline-none"
        />
        <IconButton
          type="submit"
          label={t('expenses.comments.send')}
          icon={<SendHorizontal />}
          variant="ink"
          disabled={!body.trim()}
        />
      </form>
    </section>
  )
}
