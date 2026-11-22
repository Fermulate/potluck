/**
 * Quick polls (ADR 22): availability polls anyone can make and answer without an account. Every
 * call goes through an anon-callable RPC; the browser keeps the tokens they hand back.
 */
import type { QuickPollSlotMinutes, QuickPollTtl, SlotGrid } from '@potluck/core'
import { queryOptions } from '@tanstack/react-query'
import type { Database } from './database.types'
import type { PotluckClient } from './index'
import { PlanError } from './plans'

type PreviewRow = Database['public']['Functions']['quick_poll_preview']['Returns'][number]

// A type, not an interface, so it fits the Json argument of the RPC.
export type QuickPollSlot = {
  slot_start: string
  level: 'yes' | 'maybe'
}

export interface QuickPollAnswer {
  /** 1, 2, 3... in the order people answered. */
  seat: number
  /** Null when the poll does not ask for names. */
  name: string | null
  /** True for the answer the visitor's token belongs to. */
  mine: boolean
  slots: QuickPollSlot[]
}

export interface QuickPollInfo {
  /** Null when the creator gave none; show a default. */
  title: string | null
  grid: SlotGrid
  durationMinutes: number
  namesRequired: boolean
  maxPeople: number
  expiresAt: string
}

/** A poll as its link shows it. An expired poll shows nothing else. */
export type QuickPollView =
  | { status: 'expired' }
  | {
      status: 'open' | 'full' | 'closed'
      poll: QuickPollInfo
      answers: QuickPollAnswer[]
      isCreator: boolean
    }

export interface CreateQuickPollInput {
  title: string | null
  timeZone: string
  windowStart: string
  windowEnd: string
  dayStartMinute: number
  dayEndMinute: number
  durationMinutes: number
  slotMinutes: QuickPollSlotMinutes
  ttl: QuickPollTtl
  namesRequired: boolean
  maxPeople: number
}

export interface CreatedQuickPoll {
  code: string
  /** Keep it: it closes and deletes the poll, and is the creator's answer token. */
  creatorToken: string
  expiresAt: string
}

export const quickPollKeys = {
  all: ['potluck', 'quick-poll'] as const,
  preview: (code: string) => ['potluck', 'quick-poll', code] as const,
}

function fail(error: { message: string; details?: string | null } | null): never {
  throw new PlanError(error?.message || 'unknown', error?.details ?? undefined)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function parseAnswers(value: unknown): QuickPollAnswer[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const a = record(item)
    return {
      seat: Number(a.seat) || 0,
      name: typeof a.name === 'string' ? a.name : null,
      mine: a.mine === true,
      slots: Array.isArray(a.slots)
        ? a.slots.map((slot) => {
            const s = record(slot)
            return {
              slot_start: String(s.slot_start),
              level: s.level === 'maybe' ? 'maybe' : 'yes',
            }
          })
        : [],
    }
  })
}

/** The preview row as a view. An unknown status reads as expired, which shows nothing. */
function parseQuickPollView(row: PreviewRow): QuickPollView {
  const status = row.status
  if (status !== 'open' && status !== 'full' && status !== 'closed') return { status: 'expired' }
  return {
    status,
    poll: {
      // The generated type says string; a poll without a title comes back null.
      title: (row.title as string | null) ?? null,
      grid: {
        windowStart: row.window_start,
        windowEnd: row.window_end,
        dayStartMinute: row.day_start_minute,
        dayEndMinute: row.day_end_minute,
        slotMinutes: row.slot_minutes,
        timeZone: row.timezone,
      },
      durationMinutes: row.duration_minutes,
      namesRequired: row.names_required,
      maxPeople: row.max_people,
      expiresAt: row.expires_at,
    },
    answers: parseAnswers(row.answers),
    isCreator: row.is_creator === true,
  }
}

/** Works signed out. Throws `quick_poll_not_found` for an unknown code. */
export async function fetchQuickPollPreview(
  client: PotluckClient,
  code: string,
  token: string | null,
): Promise<QuickPollView> {
  const { data, error } = await client.rpc('quick_poll_preview', {
    code,
    ...(token ? { token } : {}),
  })
  if (error) fail(error)
  const row = data?.[0]
  if (!row) throw new PlanError('quick_poll_not_found')
  return parseQuickPollView(row)
}

export async function createQuickPoll(
  client: PotluckClient,
  input: CreateQuickPollInput,
): Promise<CreatedQuickPoll> {
  const { data, error } = await client.rpc('create_quick_poll', {
    payload: {
      title: input.title,
      timezone: input.timeZone,
      window_start: input.windowStart,
      window_end: input.windowEnd,
      day_start_minute: input.dayStartMinute,
      day_end_minute: input.dayEndMinute,
      duration_minutes: input.durationMinutes,
      slot_minutes: input.slotMinutes,
      ttl: input.ttl,
      names_required: input.namesRequired,
      max_people: input.maxPeople,
    },
  })
  if (error) fail(error)
  const row = data?.[0]
  if (!row) throw new PlanError('unknown')
  return { code: row.code, creatorToken: row.creator_token, expiresAt: row.expires_at }
}

/**
 * Adds or replaces the visitor's answer. With no token (or one the poll does not know) the server
 * makes a new answer and returns its token; keep it to edit later. The creator passes their
 * creator token and gets it back.
 */
export async function setQuickPollAvailability(
  client: PotluckClient,
  input: { code: string; name: string | null; token: string | null; slots: QuickPollSlot[] },
): Promise<{ token: string; saved: number }> {
  const { data, error } = await client.rpc('set_quick_poll_availability', {
    code: input.code,
    // Ignored when the poll does not ask for names.
    name: input.name ?? '',
    // An empty token is one the poll does not know, so the server makes a new answer.
    token: input.token ?? '',
    slots: input.slots,
  })
  if (error) fail(error)
  const row = data?.[0]
  if (!row) throw new PlanError('unknown')
  return { token: row.answer_token, saved: row.saved }
}

/** Creator only (`not_allowed` otherwise). Stops answers; results stay readable until expiry. */
export async function closeQuickPoll(
  client: PotluckClient,
  input: { code: string; creatorToken: string },
): Promise<void> {
  const { error } = await client.rpc('close_quick_poll', {
    code: input.code,
    token: input.creatorToken,
  })
  if (error) fail(error)
}

/** Creator only (`not_allowed` otherwise). Deletes the poll and every answer now. */
export async function deleteQuickPoll(
  client: PotluckClient,
  input: { code: string; creatorToken: string },
): Promise<void> {
  const { error } = await client.rpc('delete_quick_poll', {
    code: input.code,
    token: input.creatorToken,
  })
  if (error) fail(error)
}

export const quickPollQueries = {
  preview: (client: PotluckClient, code: string, token: string | null) =>
    queryOptions({
      queryKey: [...quickPollKeys.preview(code), token ?? ''] as const,
      queryFn: () => fetchQuickPollPreview(client, code, token),
      // An unknown code stays unknown.
      retry: (count: number, error: unknown) =>
        !(error instanceof PlanError && error.code === 'quick_poll_not_found') && count < 2,
    }),
}
