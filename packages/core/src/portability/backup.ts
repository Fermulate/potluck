import { z } from 'zod'

/**
 * The JSON backup (`export_my_data()`), version 1. docs/backup-format.md describes every field;
 * this schema is the same contract in code, used by the tests and by anything that reads a
 * backup back. Money is integer minor units, rates and weights are decimal text, times are ISO
 * timestamps, days are YYYY-MM-DD. Fields may be added within a version; a field that changes
 * meaning or goes away means version 2.
 */

export const BACKUP_FORMAT = 'potluck-backup'
export const BACKUP_VERSION = 1

const uuid = z.guid()
const cents = z.number().int().safe()
const day = z.iso.date()
const time = z.string().min(1)
const rate = z.string().regex(/^\d+(\.\d+)?$/)
const comment = z.object({ id: uuid, author_id: uuid, body: z.string(), created_at: time })

const expense = z.object({
  id: uuid,
  description: z.string(),
  amount_cents: cents,
  currency: z.string().length(3),
  fx_rate: rate,
  is_refund: z.boolean(),
  split_type: z.string(),
  category: z.string().nullable(),
  notes: z.string().nullable(),
  spent_at: day,
  tax_cents: cents.nullable(),
  tip_cents: cents.nullable(),
  discount_cents: cents.nullable(),
  event_id: uuid.nullable(),
  recurring_id: uuid.nullable(),
  receipt_path: z.string().nullable(),
  created_by: uuid.nullable(),
  created_at: time,
  updated_at: time,
  deleted_at: time.nullable(),
  payers: z.array(z.object({ user_id: uuid, paid_cents: cents })),
  splits: z.array(
    z.object({
      user_id: uuid,
      share_cents: cents,
      weight: rate.nullable(),
      adjustment_cents: cents.nullable(),
    }),
  ),
  items: z.array(
    z.object({
      position: z.number().int(),
      description: z.string(),
      amount_cents: cents,
      user_ids: z.array(uuid),
    }),
  ),
  comments: z.array(comment),
})

const payment = z.object({
  id: uuid,
  from_user: uuid,
  to_user: uuid,
  amount_cents: cents,
  currency: z.string().length(3),
  fx_rate: rate,
  note: z.string().nullable(),
  settled_at: time,
  created_by: uuid.nullable(),
  created_at: time,
  deleted_at: time.nullable(),
})

const recurring = z.object({
  id: uuid,
  description: z.string(),
  amount_cents: cents,
  currency: z.string().length(3),
  paid_by: uuid,
  payers: z.array(z.object({ user_id: uuid, paid_cents: cents })).nullable(),
  split_type: z.string(),
  splits: z.array(z.record(z.string(), z.unknown())),
  category: z.string().nullable(),
  recurrence: z.string(),
  next_run_on: day,
  active: z.boolean(),
  created_by: uuid.nullable(),
  created_at: time,
})

const plan = z.object({
  id: uuid,
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  emoji: z.string().nullable(),
  status: z.string(),
  timezone: z.string(),
  window_start: day,
  window_end: day,
  day_start_minute: z.number().int(),
  day_end_minute: z.number().int(),
  slot_minutes: z.number().int(),
  duration_minutes: z.number().int(),
  min_attendees: z.number().int(),
  starts_at: time.nullable(),
  ends_at: time.nullable(),
  rsvp_deadline: time.nullable(),
  created_by: uuid.nullable(),
  created_at: time,
  rsvps: z.array(z.object({ user_id: uuid, status: z.string(), updated_at: time })),
  availability: z.array(z.object({ user_id: uuid, slot_start: time, level: z.string() })),
  comments: z.array(comment),
})

const group = z.object({
  id: uuid,
  name: z.string(),
  emoji: z.string().nullable(),
  color: z.string().nullable(),
  currency: z.string().length(3),
  is_direct: z.boolean(),
  simplify_debts: z.boolean(),
  members_can_invite: z.boolean(),
  default_split: z.unknown().nullable(),
  created_by: uuid.nullable(),
  created_at: time,
  archived_at: time.nullable(),
  members: z.array(z.object({ user_id: uuid, role: z.string(), joined_at: time })),
  expenses: z.array(expense),
  payments: z.array(payment),
  recurring: z.array(recurring),
  plans: z.array(plan),
})

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exported_at: time,
  profile: z.object({
    id: uuid,
    display_name: z.string(),
    email: z.string().nullable(),
    avatar_path: z.string().nullable(),
    timezone: z.string(),
    default_currency: z.string().length(3),
    locale: z.string(),
    created_at: time,
  }),
  people: z.array(z.object({ id: uuid, display_name: z.string(), deleted: z.boolean() })),
  friends: z.array(uuid),
  groups: z.array(group),
})

export type Backup = z.infer<typeof backupSchema>
export type BackupGroup = Backup['groups'][number]
export type BackupExpense = BackupGroup['expenses'][number]
export type BackupPayment = BackupGroup['payments'][number]
