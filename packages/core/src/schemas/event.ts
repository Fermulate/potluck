import { z } from 'zod'
import { dateOnly, id, optionalText, timestamp } from './common'

/** Longest availability poll, in days (inclusive of both ends). */
export const MAX_WINDOW_DAYS = 62

export const SLOT_SIZES = [15, 30, 60] as const

const DAY_MS = 86_400_000
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS

/** Payload for creating an event. Defaults match the `events` table. */
export const eventCreateSchema = z
  .object({
    group_id: id,
    title: z.string().trim().min(1).max(120),
    description: optionalText(2000),
    location: optionalText(200),
    emoji: optionalText(16),
    window_start: dateOnly,
    window_end: dateOnly,
    day_start_minute: z.number().int().min(0).max(1439).default(480),
    day_end_minute: z.number().int().min(1).max(1440).default(1320),
    slot_minutes: z
      .number()
      .refine((n) => (SLOT_SIZES as readonly number[]).includes(n), 'invalid_slot_size')
      .default(30),
    duration_minutes: z.number().int().positive().max(1440).default(120),
    min_attendees: z.number().int().min(1).max(1000).default(2),
    rsvp_deadline: timestamp.nullish().default(null),
  })
  .superRefine((event, ctx) => {
    const issue = (message: string, field: string) =>
      ctx.addIssue({ code: 'custom', message, path: [field] })

    const days = daysBetween(event.window_start, event.window_end)
    if (days < 0) issue('window_end_before_start', 'window_end')
    else if (days + 1 > MAX_WINDOW_DAYS) issue('window_too_long', 'window_end')

    const dayLength = event.day_end_minute - event.day_start_minute
    if (dayLength <= 0) issue('day_end_before_start', 'day_end_minute')
    else if (event.duration_minutes > dayLength) issue('duration_too_long', 'duration_minutes')
  })

export type EventCreateInput = z.input<typeof eventCreateSchema>
export type EventCreatePayload = z.output<typeof eventCreateSchema>
