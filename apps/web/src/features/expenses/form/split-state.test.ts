import { describe, expect, it } from 'vitest'
import {
  FULL,
  defaultFromDraft,
  draftFromExpense,
  evenPercent,
  formerParticipants,
  initialDraft,
  itemsPayload,
  matchesDefault,
  moveBoundary,
  previewSplit,
  roundingExtras,
  sameSplit,
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

  it('gives someone toggled back in a share again', () => {
    const zeroed = {
      ...initialDraft(ids),
      mode: 'shares' as const,
      shares: { [A]: 2, [B]: 1, [C]: 0 },
    }
    const out = toggleParticipant(zeroed, C, ids)
    const back = toggleParticipant(out, C, ids)
    expect(back.participants).toEqual(ids)
    expect(back.shares[C]).toBe(1)
    expect(previewSplit(back, 400)).toEqual({ ok: true, shares: { [A]: 200, [B]: 100, [C]: 100 } })
  })

  it('keeps a share count someone had when toggled back in', () => {
    const draft = {
      ...initialDraft(ids),
      mode: 'shares' as const,
      shares: { [A]: 1, [B]: 1, [C]: 3 },
    }
    const back = toggleParticipant(toggleParticipant(draft, C, ids), C, ids)
    expect(back.shares[C]).toBe(3)
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
          { user_id: B, share_cents: 300, weight: 30, adjustment_cents: null },
          { user_id: A, share_cents: 700, weight: 70, adjustment_cents: null },
        ],
      },
      ids,
    )
    expect(draft.mode).toBe('percent')
    expect(draft.participants).toEqual([A, B])
    expect(draft.percent).toEqual({ [A]: 7000, [B]: 3000 })
  })
})

describe('editing a split with someone who left the group', () => {
  const GONE = 'dddddddd-0000-4000-8000-000000000004'
  const saved = {
    split_type: 'exact' as const,
    expense_splits: [
      { user_id: A, share_cents: 600, weight: null, adjustment_cents: null },
      { user_id: GONE, share_cents: 400, weight: null, adjustment_cents: null },
    ],
  }

  it('keeps them in the draft, with their exact share, and says who they are', () => {
    const draft = draftFromExpense(saved, ids)
    expect(draft.participants).toEqual([A, GONE])
    expect(draft.exact).toEqual({ [A]: 600, [GONE]: 400 })
    expect(formerParticipants(draft, ids)).toEqual([GONE])
    // By item, only the people on the bill count.
    const items = [{ id: 'i1', name: 'Pie', amountCents: 500, userIds: [A] }]
    expect(formerParticipants({ ...draft, mode: 'itemized', items }, ids)).toEqual([])
    const shared = [{ ...items[0]!, userIds: [A, GONE] }]
    expect(formerParticipants({ ...draft, mode: 'itemized', items: shared }, ids)).toEqual([GONE])
  })

  it('treats an untouched draft as the same split, and any change as a new one', () => {
    const start = draftFromExpense(saved, ids)
    expect(sameSplit(start, draftFromExpense(saved, ids))).toBe(true)
    expect(sameSplit(start, { ...start, exact: { ...start.exact, [A]: 500 } })).toBe(false)
    expect(sameSplit(start, { ...start, mode: 'equal' })).toBe(false)
    const without = toggleParticipant(start, GONE, [...ids, GONE])
    expect(without.participants).toEqual([A])
    expect(formerParticipants(without, ids)).toEqual([])
    expect(sameSplit(start, without)).toBe(false)
    // Taking them out and back in again is the same split.
    expect(sameSplit(start, toggleParticipant(without, GONE, [...ids, GONE]))).toBe(true)
    expect(sameSplit({ ...start, mode: 'itemized' }, { ...start, mode: 'itemized' })).toBe(false)
  })

  it('compares percent and share values too', () => {
    const pct = draftFromExpense(
      {
        split_type: 'percent',
        expense_splits: [
          { user_id: A, share_cents: 700, weight: 70, adjustment_cents: null },
          { user_id: B, share_cents: 300, weight: 30, adjustment_cents: null },
        ],
      },
      ids,
    )
    expect(sameSplit(pct, { ...pct, percent: { [A]: 6000, [B]: 4000 } })).toBe(false)
    expect(sameSplit(pct, { ...pct })).toBe(true)
    const shares = { ...pct, mode: 'shares' as const, shares: { [A]: 1, [B]: 2 } }
    expect(sameSplit(shares, { ...shares, shares: { [A]: 2, [B]: 2 } })).toBe(false)
  })
})

describe('adjustment split', () => {
  it('previews, sends and reopens the adjustments', () => {
    const draft = { ...initialDraft(ids), mode: 'adjustment' as const, adjust: { [A]: 1000 } }
    expect(previewSplit(draft, 10000)).toEqual({
      ok: true,
      shares: { [A]: 4000, [B]: 3000, [C]: 3000 },
    })
    expect(splitsPayload(draft, 10000)).toEqual([
      { user_id: A, adjustment_cents: 1000 },
      { user_id: B, adjustment_cents: 0 },
      { user_id: C, adjustment_cents: 0 },
    ])
    const reopened = draftFromExpense(
      {
        split_type: 'adjustment',
        expense_splits: [
          { user_id: A, share_cents: 4000, weight: null, adjustment_cents: 1000 },
          { user_id: B, share_cents: 3000, weight: null, adjustment_cents: 0 },
          { user_id: C, share_cents: 3000, weight: null, adjustment_cents: 0 },
        ],
      },
      ids,
    )
    expect(reopened.mode).toBe('adjustment')
    expect(reopened.adjust).toEqual({ [A]: 1000, [B]: 0, [C]: 0 })
    expect(sameSplit(reopened, { ...reopened })).toBe(true)
    expect(sameSplit(reopened, { ...reopened, adjust: { [A]: 500 } })).toBe(false)
  })

  it('names who rounds up in the equal part only', () => {
    const draft = { ...initialDraft(ids), mode: 'adjustment' as const, adjust: { [B]: -100 } }
    expect(roundingExtras(draft, previewSplit(draft, 1000))).toEqual([A, B])
  })
})

describe('default split', () => {
  it('starts a new expense from the group default, ignoring people who left', () => {
    const GONE = 'dddddddd-0000-4000-8000-000000000004'
    const shares = initialDraft(ids, {
      split_type: 'shares',
      splits: [
        { user_id: A, weight: 2 },
        { user_id: B, weight: 1 },
        { user_id: GONE, weight: 1 },
      ],
    })
    expect(shares.mode).toBe('shares')
    expect(shares.participants).toEqual([A, B])
    expect(previewSplit(shares, 900)).toEqual({ ok: true, shares: { [A]: 600, [B]: 300 } })

    // A percent default that lost someone no longer adds up: equal between who is left.
    const percent = initialDraft(ids, {
      split_type: 'percent',
      splits: [
        { user_id: A, weight: 50 },
        { user_id: GONE, weight: 50 },
      ],
    })
    expect(percent.mode).toBe('equal')
    expect(percent.participants).toEqual([A])
    expect(
      initialDraft(ids, { split_type: 'equal', splits: [{ user_id: GONE, weight: null }] })
        .participants,
    ).toEqual(ids)
  })

  it('turns a draft into a default and recognizes it', () => {
    const draft = {
      ...initialDraft(ids),
      mode: 'percent' as const,
      percent: { [A]: 6000, [B]: 4000, [C]: 0 },
    }
    const saved = defaultFromDraft(draft)
    expect(saved).toEqual({
      split_type: 'percent',
      splits: [
        { user_id: A, weight: 60 },
        { user_id: B, weight: 40 },
      ],
    })
    expect(matchesDefault(initialDraft(ids, saved), saved)).toBe(true)
    expect(matchesDefault(initialDraft(ids), saved)).toBe(false)
    expect(defaultFromDraft({ ...draft, mode: 'exact' })).toBeNull()
    expect(defaultFromDraft(initialDraft(ids))?.split_type).toBe('equal')
  })
})

describe('stored items', () => {
  it('sends the bill as entered, and reopens it', () => {
    const draft = {
      ...initialDraft(ids),
      mode: 'itemized' as const,
      items: [
        { id: '1', name: ' Noodles ', amountCents: 1000, userIds: [A] },
        { id: '2', name: '', amountCents: null, userIds: [A, B] },
      ],
      taxCents: 120,
      tipCents: 0,
      discountCents: 20,
    }
    expect(itemsPayload(draft)).toEqual({
      items: [{ description: 'Noodles', amount_cents: 1000, user_ids: [A] }],
      tax_cents: 120,
      tip_cents: null,
      discount_cents: 20,
    })
    expect(previewSplit(draft, 1100)).toEqual({ ok: true, shares: { [A]: 1100 } })
    const reopened = draftFromExpense(
      {
        split_type: 'itemized',
        expense_splits: [{ user_id: A, share_cents: 1100, weight: null, adjustment_cents: null }],
        expense_items: [{ position: 0, description: 'Noodles', amount_cents: 1000, user_ids: [A] }],
        tax_cents: 120,
        tip_cents: null,
        discount_cents: 20,
      },
      ids,
    )
    expect(reopened.mode).toBe('itemized')
    expect(reopened.items.map((i) => [i.name, i.amountCents, i.userIds])).toEqual([
      ['Noodles', 1000, [A]],
    ])
    expect([reopened.taxCents, reopened.tipCents, reopened.discountCents]).toEqual([120, null, 20])
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
