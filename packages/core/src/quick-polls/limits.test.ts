import { describe, expect, it } from 'vitest'
import {
  isQuickPollTtl,
  QUICK_POLL_DEFAULT_PEOPLE,
  QUICK_POLL_MAX_PEOPLE,
  QUICK_POLL_MIN_PEOPLE,
  quickPollWindowFits,
} from './index'

// Same cases as supabase/tests/36_quick_polls.test.sql.
describe('quick poll limits', () => {
  it('takes 2 to 15 people, 10 by default', () => {
    expect([QUICK_POLL_MIN_PEOPLE, QUICK_POLL_DEFAULT_PEOPLE, QUICK_POLL_MAX_PEOPLE]).toEqual([
      2, 10, 15,
    ])
  })

  it('lasts 24 hours or 7 days', () => {
    expect(isQuickPollTtl('24h')).toBe(true)
    expect(isQuickPollTtl('7d')).toBe(true)
    expect(isQuickPollTtl('30d')).toBe(false)
    expect(isQuickPollTtl(null)).toBe(false)
  })

  it('covers 1 to 14 days, both ends included', () => {
    expect(quickPollWindowFits('2026-06-01', '2026-06-01')).toBe(true)
    expect(quickPollWindowFits('2026-06-01', '2026-06-14')).toBe(true)
    expect(quickPollWindowFits('2026-06-01', '2026-06-15')).toBe(false)
    expect(quickPollWindowFits('2026-06-02', '2026-06-01')).toBe(false)
    expect(quickPollWindowFits('2026-03-25', '2026-04-07')).toBe(true)
    expect(quickPollWindowFits('nope', '2026-06-01')).toBe(false)
  })
})
