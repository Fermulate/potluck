import { CATEGORY_IDS, SPLIT_TYPES, type SplitError } from '@potluck/core'
import { describe, expect, it } from 'vitest'
import { en, hasMessage } from './index'

function leaves(node: object, prefix = ''): [string, string][] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [[path, value] as [string, string]] : leaves(value, path)
  })
}

const all = leaves(en)

describe('the English dictionary', () => {
  it('never uses em or en dashes', () => {
    const offenders = all.filter(([, text]) => /[\u2013\u2014]/.test(text)).map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('has well formed placeholders', () => {
    const offenders = all
      .filter(([, text]) => {
        const stripped = text.replace(/\{\w+\}/g, '')
        return stripped.includes('{') || stripped.includes('}')
      })
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('pairs every _one form with an _other form', () => {
    const keys = new Set(all.map(([key]) => key))
    const orphans = [...keys]
      .filter((key) => /_(zero|one)$/.test(key))
      .filter((key) => !keys.has(key.replace(/_(zero|one)$/, '_other')))
    expect(orphans).toEqual([])
  })

  it('uses {count} in every plural _other form', () => {
    const missing = all
      .filter(([key, text]) => key.endsWith('_other') && !text.includes('{count}'))
      .map(([key]) => key)
    expect(missing).toEqual([])
  })

  it('has no blank strings', () => {
    expect(all.filter(([, text]) => text.trim() === '').map(([key]) => key)).toEqual([])
  })
})

const missingKeys = (keys: string[]) => keys.filter((key) => !hasMessage(key))

describe('coverage of core domain values', () => {
  it('labels every expense category', () => {
    expect(missingKeys(CATEGORY_IDS.map((id) => `categories.${id}`))).toEqual([])
  })

  it('labels and explains every split type', () => {
    expect(
      missingKeys(
        SPLIT_TYPES.flatMap((type) => [`splitTypes.${type}.label`, `splitTypes.${type}.hint`]),
      ),
    ).toEqual([])
  })

  it('explains every split error code from core', () => {
    const codes = [
      'invalid_total',
      'no_users',
      'duplicate_user',
      'invalid_amount',
      'sum_mismatch',
      'invalid_weight',
      'percent_sum',
      'zero_shares',
      'no_items',
      'item_no_users',
      'invalid_item_amount',
      'invalid_extra',
    ] satisfies SplitError['code'][]
    expect(missingKeys(codes.map((code) => `errors.split.${code}`))).toEqual([])
  })

  it('explains every custom schema validation code from core', () => {
    const codes = [
      'invalid_currency',
      'splits_sum_mismatch',
      'duplicate_split_user',
      'percent_sum',
      'shares_required',
      'invalid_slot_size',
      'window_end_before_start',
      'window_too_long',
      'day_end_before_start',
      'duration_too_long',
    ]
    expect(missingKeys(codes.map((code) => `errors.validation.${code}`))).toEqual([])
  })

  it('describes every activity verb', () => {
    const verbs = [
      'group.created',
      'group.updated',
      'member.joined',
      'member.left',
      'member.removed',
      'member.role_changed',
      'expense.created',
      'expense.updated',
      'expense.deleted',
      'expense.restored',
      'settlement.created',
      'settlement.deleted',
      'event.created',
      'event.scheduled',
      'event.cancelled',
      'availability.requested',
      'comment.created',
    ]
    expect(missingKeys(verbs.map((verb) => `activity.${verb}`))).toEqual([])
  })

  it('has a title and body for every notification type', () => {
    const types = [
      'expense.created',
      'expense.updated',
      'settlement.created',
      'member.joined',
      'event.created',
      'event.scheduled',
      'event.cancelled',
      'event.reminder',
      'availability.requested',
      'rsvp.reminder',
      'comment.created',
    ]
    expect(
      missingKeys(
        types.flatMap((type) => [
          `notifications.types.${type}.title`,
          `notifications.types.${type}.body`,
        ]),
      ),
    ).toEqual([])
  })

  it('labels every event status, RSVP status, and availability level', () => {
    expect(
      missingKeys([
        ...['polling', 'scheduled', 'cancelled', 'done'].map((s) => `events.status.${s}`),
        ...['going', 'maybe', 'declined'].map((s) => `rsvp.status.${s}`),
        ...['yes', 'maybe'].map((level) => `availability.levels.${level}`),
      ]),
    ).toEqual([])
  })

  it('has plan screens: best time and timeline', () => {
    expect(
      missingKeys([
        'bestTime.title',
        'bestTime.score',
        'bestTime.missing',
        'bestTime.lockIn',
        'timeline.title',
        'timeline.empty.title',
      ]),
    ).toEqual([])
  })

  it('gives every empty state a headline, a line of body copy, and an action', () => {
    const screens = [
      'groups',
      'expenses',
      'balances',
      'activity',
      'plans',
      'notifications',
      'search',
    ]
    expect(
      missingKeys(
        screens.flatMap((s) => [`empty.${s}.title`, `empty.${s}.body`, `empty.${s}.action`]),
      ),
    ).toEqual([])
  })

  it('covers settings and account deletion', () => {
    expect(
      missingKeys([
        'settings.title',
        'settings.profile.title',
        'settings.preferences.timezone',
        'settings.preferences.currency',
        'settings.notifications.title',
        'account.delete.title',
        'account.delete.warning',
        'account.delete.confirmPhrase',
        'account.delete.blocked',
        'account.delete.submit',
        'account.delete.done',
      ]),
    ).toEqual([])
  })

  it('names and describes every group role', () => {
    expect(
      missingKeys(
        (['owner', 'admin', 'member'] as const).flatMap((role) => [
          `roles.${role}.label`,
          `roles.${role}.description`,
        ]),
      ),
    ).toEqual([])
  })
})
