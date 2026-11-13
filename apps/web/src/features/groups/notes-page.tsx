import {
  groupKeys,
  saveWhiteboard,
  whiteboardHistoryQueryOptions,
  whiteboardQueryOptions,
  type GroupDetail,
  type WhiteboardRow,
} from '@potluck/api'
import { can, firstName } from '@potluck/core'
import { formatRelative, intlLocale, t } from '@potluck/i18n'
import { Avatar, Button, cn, Skeleton, toast } from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { ChevronDown, History } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { errorCode, errorMessage } from '@/lib/errors'
import { avatarSrc, useViewerTimezone } from '@/lib/queries'
import { useBatchedInvalidate, useRealtime } from '@/lib/realtime'
import { rpcKeepalive } from '@/lib/rpc-keepalive'
import { supabase } from '@/lib/supabase'
import { useGroup } from './use-groups'

const MAX = 10000
const SAVE_AFTER_MS = 900

/** The group's shared notes: a page anyone in the group can write on, saved as they type. */
export function GroupNotesPage({ groupId }: { groupId: string }) {
  const { data: group } = useGroup(groupId)
  const board = useQuery(whiteboardQueryOptions(supabase, groupId))
  const invalidate = useBatchedInvalidate()
  useRealtime(
    `whiteboard-${groupId}`,
    [{ table: 'group_whiteboards', filter: `group_id=eq.${groupId}` }],
    () => invalidate(groupKeys.whiteboard(groupId), groupKeys.whiteboardHistory(groupId)),
  )

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="font-display text-3xl">{t('groups.notes.title')}</h2>
          <p className="max-w-prose text-sm text-mute">{t('groups.notes.hint')}</p>
        </div>
        <Help topic="notes" />
      </div>
      {group && board.data ? (
        <NotesEditor group={group} board={board.data} />
      ) : (
        <Skeleton className="h-72 rounded-card" />
      )}
      {group && <NotesHistory group={group} />}
    </div>
  )
}

function useNameOf(group: GroupDetail) {
  const me = useUserId()
  return (id: string | null | undefined) => {
    const person = group.members.find((m) => m.id === id)
    if (id === me) return t('activity.you')
    return person ? firstName(person.display_name) : t('activity.someone')
  }
}

function NotesEditor({ group, board }: { group: GroupDetail; board: WhiteboardRow }) {
  const me = useUserId()
  const timeZone = useViewerTimezone()
  const queryClient = useQueryClient()
  const nameOf = useNameOf(group)
  const fieldId = useId()
  const statusId = useId()
  const editable = !group.archived_at && can(group.my_role, 'group.notes')

  // What the box shows, the saved text it started from, and that text's version.
  const [text, setText] = useState(board.body)
  const [saved, setSaved] = useState({ body: board.body, version: board.version })
  const [seenVersion, setSeenVersion] = useState(board.version)
  const [conflict, setConflict] = useState(false)
  const [liveFrom, setLiveFrom] = useState<string | null>(null)
  // Text whose save failed (offline, say): not retried on a timer, only on the next edit or blur.
  const [failed, setFailed] = useState<string | null>(null)
  const dirty = text !== saved.body

  // A newer version arrived (realtime refetch). Take it when nothing is typed over it; when
  // something is, let the person choose.
  if (board.version !== seenVersion) {
    setSeenVersion(board.version)
    if (board.version > saved.version) {
      if (!dirty) {
        setText(board.body)
        setSaved({ body: board.body, version: board.version })
        setLiveFrom(board.updated_by && board.updated_by !== me ? nameOf(board.updated_by) : null)
      } else if (board.updated_by !== me) {
        setConflict(true)
      }
    }
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: groupKeys.whiteboard(group.id) })
    void queryClient.invalidateQueries({ queryKey: groupKeys.whiteboardHistory(group.id) })
  }

  const save = useMutation({
    mutationFn: (vars: { body: string; base: number }) =>
      saveWhiteboard(supabase, group.id, vars.body, vars.base),
    onSuccess: (row) => {
      setSaved({ body: row.body, version: row.version })
      refresh()
    },
    onError: (error, vars) => {
      if (errorCode(error) === 'whiteboard_conflict') setConflict(true)
      else {
        setFailed(vars.body)
        toast.error(errorMessage(error))
      }
      refresh()
    },
  })

  const { mutate, isPending } = save
  const flush = () => {
    if (!editable || conflict || isPending || text === saved.body) return
    mutate({ body: text, base: saved.version })
  }

  // Save a moment after typing stops.
  useEffect(() => {
    if (!editable || conflict || isPending || text === saved.body || text === failed) return
    const timer = window.setTimeout(
      () => mutate({ body: text, base: saved.version }),
      SAVE_AFTER_MS,
    )
    return () => window.clearTimeout(timer)
  }, [text, saved, conflict, editable, isPending, mutate, failed])

  const unsaved = useRef<{ body: string; base: number } | null>(null)
  useEffect(() => {
    unsaved.current =
      editable && !conflict && text !== saved.body ? { body: text, base: saved.version } : null
  })
  useEffect(() => {
    const groupId = group.id
    const leave = (closing: boolean) => {
      const next = unsaved.current
      if (!next) return
      unsaved.current = null
      const args = { group_id: groupId, body: next.body, base_version: next.base }
      if (closing && rpcKeepalive('save_group_whiteboard', args)) return
      void saveWhiteboard(supabase, groupId, next.body, next.base).then(
        () => queryClient.invalidateQueries({ queryKey: groupKeys.whiteboard(groupId) }),
        () => undefined,
      )
    }
    const onPageHide = () => leave(true)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      leave(false)
    }
  }, [group.id, queryClient])

  const held = editable && (conflict || (failed !== null && text !== saved.body))
  useBlocker({
    shouldBlockFn: () => !window.confirm(t('groups.notes.leaveUnsaved')),
    enableBeforeUnload: held,
    disabled: !held,
  })

  async function keepMine() {
    try {
      const latest = await queryClient.fetchQuery({
        ...whiteboardQueryOptions(supabase, group.id),
        staleTime: 0,
      })
      setSaved((s) => ({ ...s, version: latest.version }))
      setSeenVersion(latest.version)
      setConflict(false)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const status = conflict
    ? null
    : isPending
      ? t('groups.notes.saving')
      : dirty
        ? t('groups.notes.unsaved')
        : liveFrom
          ? t('groups.notes.theyEdited', { name: liveFrom })
          : saved.version > 0
            ? t('groups.notes.saved')
            : null
  const edited =
    board.updated_by && board.updated_at
      ? board.updated_by === me
        ? t('groups.notes.editedByYou', { when: formatRelative(board.updated_at, { timeZone }) })
        : t('groups.notes.edited', {
            name: nameOf(board.updated_by),
            when: formatRelative(board.updated_at, { timeZone }),
          })
      : null

  return (
    <div className="grid gap-3">
      <label id={`${fieldId}-label`} htmlFor={fieldId} className="sr-only">
        {t('groups.notes.label')}
      </label>
      {conflict && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-card border border-saffron bg-saffron-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {t('groups.notes.conflict', { name: nameOf(board.updated_by) })}
            </p>
            <figure className="mt-2 rounded-[0.75rem] bg-card px-3 py-2">
              <figcaption className="text-xs font-semibold text-mute">
                {t('groups.notes.theirs')}
              </figcaption>
              <blockquote className="line-clamp-4 text-sm whitespace-pre-wrap">
                {board.body}
              </blockquote>
            </figure>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setText(board.body)
                setSaved({ body: board.body, version: board.version })
                setConflict(false)
              }}
            >
              {t('groups.notes.useTheirs')}
            </Button>
            <Button size="sm" variant="ink" onClick={() => void keepMine()}>
              {t('groups.notes.keepMine')}
            </Button>
          </div>
        </div>
      )}
      {/* A ruled page with a margin line: the one bit of paper in a screen of cards. */}
      <div className="relative overflow-hidden rounded-card border border-line bg-card shadow-raised">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-10 w-px bg-tomato/35 sm:left-12"
        />
        <textarea
          id={fieldId}
          value={text}
          readOnly={!editable}
          maxLength={MAX}
          aria-describedby={statusId}
          placeholder={editable ? t('groups.notes.placeholder') : undefined}
          onChange={(e) => {
            setText(e.target.value)
            setLiveFrom(null)
          }}
          onBlur={flush}
          spellCheck
          className={cn(
            'block field-sizing-content min-h-[18rem] w-full resize-none bg-transparent py-[0.875rem] pr-5 pl-14 text-[1.0625rem] leading-8 text-ink placeholder:text-mute/80 focus-visible:outline-none sm:pl-16',
            'bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(2rem-1px),var(--pl-line)_calc(2rem-1px),var(--pl-line)_2rem)] [background-attachment:local] bg-[position:0_0.5rem]',
            !editable && 'cursor-default',
          )}
        />
      </div>
      <div
        id={statusId}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-mute"
      >
        <span role="status" className="inline-flex items-center gap-1.5 font-semibold">
          {status && (
            <span
              aria-hidden
              className={cn(
                'size-2 rounded-full',
                isPending || dirty ? 'bg-saffron' : liveFrom ? 'bg-plum' : 'bg-olive',
              )}
            />
          )}
          {status}
        </span>
        <span className="flex items-center gap-3">
          {edited && <span>{edited}</span>}
          {text.length > MAX * 0.9 && (
            <span className="tabular-nums">
              {t('groups.notes.count', {
                count: text.length.toLocaleString(intlLocale()),
                max: MAX.toLocaleString(intlLocale()),
              })}
            </span>
          )}
        </span>
      </div>
      {!editable && group.archived_at && (
        <p className="rounded-card bg-sunken p-3 text-sm text-mute">{t('groups.notes.archived')}</p>
      )}
    </div>
  )
}

function NotesHistory({ group }: { group: GroupDetail }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const timeZone = useViewerTimezone()
  const nameOf = useNameOf(group)
  const history = useQuery({
    ...whiteboardHistoryQueryOptions(supabase, group.id),
    enabled: open,
  })
  return (
    <div className="grid gap-3">
      <Button
        variant="ghost"
        size="sm"
        className="justify-self-start"
        aria-expanded={open}
        aria-controls={listId}
        leadingIcon={<History />}
        trailingIcon={
          <ChevronDown className={cn('transition-transform duration-200', open && 'rotate-180')} />
        }
        onClick={() => setOpen((v) => !v)}
      >
        {t('groups.notes.history')}
      </Button>
      {open && (
        <div id={listId}>
          {history.isPending ? (
            <Skeleton className="h-24" />
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-mute">{t('groups.notes.historyEmpty')}</p>
          ) : (
            <ol className="grid gap-3 border-l-2 border-line pl-4">
              {(history.data ?? []).map((edit) => {
                const person = group.members.find((m) => m.id === edit.actor_id)
                return (
                  <li key={edit.id} className="flex items-start gap-3">
                    <Avatar
                      name={person?.display_name ?? '?'}
                      seed={edit.actor_id ?? edit.id}
                      src={avatarSrc(person?.avatar_path)}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {nameOf(edit.actor_id)}
                        <span className="font-normal text-mute">
                          {t('common.separator')}
                          {formatRelative(edit.created_at, { timeZone })}
                        </span>
                      </p>
                      {edit.excerpt && (
                        <p className="line-clamp-2 text-sm text-mute italic">{edit.excerpt}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
