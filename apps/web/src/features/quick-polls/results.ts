import type { PlanBestSlot, PlanMember, QuickPollAnswer, QuickPollInfo } from '@potluck/api'
import { rankSlots, type SlotGrid } from '@potluck/core'
import { t } from '@potluck/i18n'
import { slotKey, type GridEvent } from '@/features/availability/grid'
import type { HeatRow } from '@/features/availability/availability-heatmap'

/**
 * The heatmap and best times work on people with ids; a poll answer's id is its seat, padded so
 * ids sort in seat order (best times lists who is missing in id order).
 */
const seatId = (seat: number) => `seat-${String(seat).padStart(2, '0')}`

/** A poll's grid in the shape the painter and heatmap read. */
export function gridEvent(grid: SlotGrid): GridEvent {
  return {
    window_start: grid.windowStart,
    window_end: grid.windowEnd,
    day_start_minute: grid.dayStartMinute,
    day_end_minute: grid.dayEndMinute,
    slot_minutes: grid.slotMinutes,
    timezone: grid.timeZone,
  }
}

/** What everyone answered, in the shapes the heatmap and best times take. */
export interface PollResults {
  people: PlanMember[]
  rows: HeatRow[]
  best: PlanBestSlot[]
  /** The visitor's own answer's id, for the dots on their cells. */
  mineId: string | undefined
}

/** An answer's name: what they typed, or "Anonymous 3" when the poll does not ask. */
export function answerName(answer: Pick<QuickPollAnswer, 'seat' | 'name'>): string {
  return answer.name ?? t('quickPolls.anonymous', { seat: answer.seat })
}

/** Ranks the answers with core `rankSlots`: anyone free for the whole length counts. */
export function pollResults(
  poll: Pick<QuickPollInfo, 'grid' | 'durationMinutes'>,
  answers: readonly QuickPollAnswer[],
): PollResults {
  const people = answers.map((a): PlanMember => ({
    userId: seatId(a.seat),
    role: 'member',
    displayName: answerName(a),
    avatarPath: null,
    deleted: false,
  }))
  const rows = answers.flatMap((a) =>
    a.slots.map((s) => ({ userId: seatId(a.seat), slot: slotKey(s.slot_start), level: s.level })),
  )
  const best = rankSlots(
    rows.map((r) => ({ userId: r.userId, slotStart: r.slot, level: r.level })),
    {
      durationMinutes: poll.durationMinutes,
      slotMinutes: poll.grid.slotMinutes,
      minAttendees: 1,
      members: people.map((p) => p.userId),
    },
  ).map((slot) => ({
    starts_at: slot.startsAt,
    ends_at: slot.endsAt,
    yes_count: slot.yesCount,
    maybe_count: slot.maybeCount,
    score: slot.score,
    missing: slot.missing,
  }))
  const mine = answers.find((a) => a.mine)
  return { people, rows, best, mineId: mine ? seatId(mine.seat) : undefined }
}
