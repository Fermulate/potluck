import { describe, expect, it } from 'vitest'
import {
  FULL,
  draftFromExpense,
  evenPercent,
  initialDraft,
  moveBoundary,
  previewSplit,
  roundingExtras,
  setPercent,
  splitsPayload,
  tipFor,
  toggleParticipant,
  withTip,
} from './split-state'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'
const ids = [A, B, C]
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

describe('tip shortcuts', () => {
  it('works out a tip from the subtotal, to the cent', () => {
    expect(tipFor(14800, 18)).toBe(2664)
    expect(tipFor(4999, 15)).toBe(750)
    expect(tipFor(0, 20)).toBe(0)
  })

  it('keeps a picked percent true to the subtotal and leaves a typed tip alone', () => {
    const base = {
      ...initialDraft(ids),
      mode: 'itemized' as const,
      items: [
        { id: '1', name: 'Dinner', amountCents: 8000, userIds: [A] },
        { id: '2', name: 'Dessert', amountCents: 2000, userIds: [A, B] },
      ],
    }
    expect(withTip({ ...base, tipPercent: 18, tipCents: 1440 }).tipCents).toBe(1800)
    expect(withTip({ ...base, tipPercent: null, tipCents: 1440 }).tipCents).toBe(1440)
  })
})

describe('percent rebalancing', () => {
  it('starts even and always totals 100%', () => {
    expect(evenPercent(ids)).toEqual({ [A]: 3334, [B]: 3333, [C]: 3333 })
  })

  it('takes what one person gains from the others in proportion', () => {
    const next = setPercent({ [A]: 2500, [B]: 2500, [C]: 5000 }, ids, A, 5000)
    expect(next).toEqual({ [A]: 5000, [B]: 1667, [C]: 3333 })
    expect(sum(next)).toBe(FULL)
  })

  it('clamps out of range values', () => {
    const next = setPercent(evenPercent(ids), ids, B, 15_000)
    expect(next[B]).toBe(FULL)
    expect(sum(next)).toBe(FULL)
  })

  it('spreads evenly when everyone else was at zero', () => {
    const next = setPercent({ [A]: FULL, [B]: 0, [C]: 0 }, ids, A, 6000)
    expect(next).toEqual({ [A]: 6000, [B]: 2000, [C]: 2000 })
  })

  it('moves only the two neighbours when a handle is dragged', () => {
    const start = { [A]: 3000, [B]: 3000, [C]: 4000 }
    expect(moveBoundary(start, ids, 1, 8000)).toEqual({ [A]: 3000, [B]: 5000, [C]: 2000 })
    // Cannot push past the next handle.
    expect(moveBoundary(start, ids, 0, 9000)).toEqual({ [A]: 6000, [B]: 0, [C]: 4000 })
  })
})

describe('split previews and payloads', () => {
  it('splits equally over the people included', () => {
    const draft = toggleParticipant(initialDraft(ids), C, ids)
    expect(previewSplit(draft, 1001)).toEqual({ ok: true, shares: { [A]: 501, [B]: 500 } })
    expect(splitsPayload(draft, 1001)).toEqual([{ user_id: A }, { user_id: B }])
  })

  it('sends weights for percent and shares, cents for exact', () => {
    const base = initialDraft(ids)
    expect(
      splitsPayload({ ...base, mode: 'percent', percent: { [A]: 5000, [B]: 5000, [C]: 0 } }, 900),
    ).toEqual([
      { user_id: A, weight: 50 },
      { user_id: B, weight: 50 },
    ])
    expect(
      splitsPayload({ ...base, mode: 'shares', shares: { [A]: 2, [B]: 1, [C]: 0 } }, 900),
    ).toEqual([
      { user_id: A, weight: 2 },
      { user_id: B, weight: 1 },
    ])
    expect(splitsPayload({ ...base, mode: 'exact', exact: { [A]: 600, [B]: 300 } }, 900)).toEqual([
      { user_id: A, share_cents: 600 },
      { user_id: B, share_cents: 300 },
    ])
  })

  it('reports how much is left in exact mode', () => {
    const draft = { ...initialDraft(ids), mode: 'exact' as const, exact: { [A]: 500 } }
    expect(previewSplit(draft, 900)).toEqual({
      ok: false,
      error: { code: 'sum_mismatch', expected: 900, actual: 500, difference: 400 },
    })
  })

  it('spreads tax and tip by what people had', () => {
    const draft = {
      ...initialDraft(ids),
      mode: 'itemized' as const,
      items: [
        { id: '1', name: 'Noodles', amountCents: 1000, userIds: [A] },
        { id: '2', name: 'Dumplings', amountCents: 2000, userIds: [A, B] },
      ],
      taxCents: 300,
      tipCents: 0,
    }
    expect(previewSplit(draft, 3300)).toEqual({ ok: true, shares: { [A]: 2200, [B]: 1100 } })
    expect(splitsPayload(draft, 3300)).toEqual([
      { user_id: A, share_cents: 2200 },
      { user_id: B, share_cents: 1100 },
    ])
  })

  it('rebuilds a saved percent split for editing', () => {
    const draft = draftFromExpense(
      {
        split_type: 'percent',
        expense_splits: [
          { user_id: B, share_cents: 300, weight: 30 },
          { user_id: A, share_cents: 700, weight: 70 },
        ],
      },
      ids,
    )
    expect(draft.mode).toBe('percent')
    expect(draft.participants).toEqual([A, B])
    expect(draft.percent).toEqual({ [A]: 7000, [B]: 3000 })
  })
})

describe('roundingExtras', () => {
  it('names whoever carries a leftover cent, and nobody for exact amounts', () => {
    const draft = initialDraft(ids)
    expect(roundingExtras(draft, previewSplit(draft, 1000))).toEqual([A])
    expect(roundingExtras(draft, previewSplit(draft, 900))).toEqual([])
    const shares = { ...draft, mode: 'shares' as const, shares: { [A]: 1, [B]: 1, [C]: 1 } }
    expect(roundingExtras(shares, previewSplit(shares, 1001))).toEqual([A, B])
    const exact = { ...draft, mode: 'exact' as const, exact: { [A]: 334, [B]: 333, [C]: 333 } }
    expect(roundingExtras(exact, previewSplit(exact, 1000))).toEqual([])
  })
})
