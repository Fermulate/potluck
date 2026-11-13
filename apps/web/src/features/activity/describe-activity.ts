import type { ActivityItem } from '@potluck/api'
import { formatDate, formatMoney, hasMessage, t } from '@potluck/i18n'

export type ActivityLink =
  | { to: '/expenses/$expenseId'; params: { expenseId: string } }
  | { to: '/payments/$paymentId'; params: { paymentId: string } }
  | { to: '/groups/$groupId'; params: { groupId: string } }
  | { to: '/groups/$groupId/balances'; params: { groupId: string } }
  | { to: '/plans/$eventId'; params: { eventId: string } }

export interface ActivityView {
  text: string
  /** Extra line, e.g. a comment excerpt. */
  detail?: string
  emoji: string
  tone: 'neutral' | 'olive' | 'plum' | 'saffron' | 'tomato'
  link: ActivityLink | null
}

interface Context {
  viewerId: string
  timeZone: string
  /** First name for a user id, or "you" style text for the viewer. */
  nameOf: (id: string | null | undefined, options?: { lower?: boolean }) => string
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

/**
 * Turns an `activity` row into a sentence. Verbs come from the database, so the message key
 * is checked at runtime (`hasMessage`) and unknown verbs get a neutral fallback.
 */
export function describeActivity(item: ActivityItem, ctx: Context): ActivityView {
  const d = item.data ?? {}
  const subjectId =
    item.verb === 'settlement.created' ? (str(d.from_user) ?? item.actor_id) : item.actor_id
  const actor = ctx.nameOf(subjectId)
  const amountCents = num(d.amount_cents)
  const currency = str(d.currency)
  const amount = amountCents !== undefined && currency ? formatMoney(amountCents, currency) : ''
  const startsAt = str(d.starts_at)
  const role = str(d.to)
  const params: Record<string, string> = {
    actor,
    group: item.group?.name ?? '',
    description: str(d.description) ?? '',
    amount,
    event: [str(d.emoji), str(d.title)].filter(Boolean).join(' '),
    date: startsAt ? formatDate(startsAt, { timeZone: ctx.timeZone, style: 'weekday' }) : '',
    name: '',
    role:
      role && hasMessage(`roles.${role}.label`)
        ? t(`roles.${role}.label` as 'roles.admin.label').toLowerCase()
        : (role ?? ''),
    subject: '',
  }

  // The person `{name}` points at, when there is one: the payee or the member acted on.
  let named: string | undefined
  let emoji = '✨'
  let tone: ActivityView['tone'] = 'neutral'
  let link: ActivityLink | null = { to: '/groups/$groupId', params: { groupId: item.group_id } }
  let detail: string | undefined

  const [kind] = item.verb.split('.')
  switch (kind) {
    case 'expense':
      emoji = item.verb === 'expense.deleted' ? '🗑️' : '🧾'
      tone = 'saffron'
      if (item.subject_id)
        link = { to: '/expenses/$expenseId', params: { expenseId: item.subject_id } }
      break
    case 'settlement': {
      emoji = item.verb === 'settlement.deleted' ? '🗑️' : '🤝'
      tone = 'olive'
      named = str(d.to_user)
      params.name = ctx.nameOf(named, { lower: true })
      link = item.subject_id
        ? { to: '/payments/$paymentId', params: { paymentId: item.subject_id } }
        : { to: '/groups/$groupId/balances', params: { groupId: item.group_id } }
      break
    }
    case 'member':
      emoji = item.verb === 'member.joined' ? '👋' : item.verb === 'member.left' ? '🚪' : '🪪'
      tone = 'plum'
      named = str(d.user_id)
      params.name = ctx.nameOf(named, { lower: true })
      break
    case 'event':
    case 'availability':
      emoji = str(d.emoji) ?? '📅'
      tone = item.verb === 'event.cancelled' ? 'tomato' : 'plum'
      // Both event and availability rows point at the event.
      if (item.subject_id) link = { to: '/plans/$eventId', params: { eventId: item.subject_id } }
      if (!params.event) params.event = t('activity.aPlan')
      break
    case 'comment': {
      emoji = '💬'
      const expenseId = str(d.expense_id)
      const eventId = str(d.event_id)
      const paymentId = str(d.settlement_id)
      params.subject = expenseId
        ? t('activity.anExpense')
        : paymentId
          ? t('activity.aPayment')
          : t('activity.aPlan')
      detail = str(d.excerpt)
      link = expenseId
        ? { to: '/expenses/$expenseId', params: { expenseId } }
        : paymentId
          ? { to: '/payments/$paymentId', params: { paymentId } }
          : eventId
            ? { to: '/plans/$eventId', params: { eventId } }
            : link
      break
    }
    case 'group':
      emoji = item.group?.emoji ?? '🍽️'
      break
  }

  // Other languages conjugate for "you", so the viewer as subject or object gets its own line.
  const own =
    subjectId === ctx.viewerId
      ? `activity.self.${item.verb}`
      : named === ctx.viewerId
        ? `activity.toYou.${item.verb}`
        : null
  const key = own && hasMessage(own) ? own : `activity.${item.verb}`
  const template = hasMessage(key) ? (key as 'activity.fallback') : null
  const text = template ? fill(t(template, { actor }), params) : t('activity.fallback', { actor })
  return { text, detail, emoji, tone, link }
}

/** Fill any remaining `{placeholders}` (the typed `t` only knows the fallback's params). */
function fill(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}
