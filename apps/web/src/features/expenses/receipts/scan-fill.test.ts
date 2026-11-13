import type { ReceiptScan } from '@potluck/core'
import { describe, expect, it } from 'vitest'
import { initialDraft, itemsTotal } from '../form/split-state'
import { defaultChoice, fillFromScan, scanFoundSomething, scanItemsTotal } from './scan-fill'

const scan = (over: Partial<ReceiptScan> = {}): ReceiptScan => ({
  merchant: "Joe's Diner",
  date: '2026-11-08',
  currency: null,
  totalCents: 5617,
  subtotalCents: 4450,
  taxCents: 367,
  tipCents: 800,
  discountCents: null,
  items: [
    { description: 'Cheeseburger', amountCents: 2500, quantity: 2 },
    { description: 'Fries', amountCents: 1950, quantity: 1 },
  ],
  ...over,
})

const all = { name: true, date: true, total: true, items: true }
const people = ['me', 'ben', 'cleo']

describe('scan review defaults', () => {
  it('ticks what it found, but not a name over one already typed', () => {
    expect(defaultChoice(scan(), '')).toEqual(all)
    expect(defaultChoice(scan(), 'Birthday dinner').name).toBe(false)
    expect(
      defaultChoice(scan({ merchant: null, date: null, totalCents: null, items: [] }), ''),
    ).toEqual({ name: false, date: false, total: false, items: false })
  })

  it('knows when a scan found nothing usable', () => {
    expect(scanFoundSomething(scan())).toBe(true)
    expect(scanFoundSomething(scan({ items: [] }))).toBe(true)
    expect(scanFoundSomething(scan({ totalCents: null, items: [] }))).toBe(false)
  })

  it('adds up the lines the way the form does', () => {
    expect(scanItemsTotal(scan())).toBe(5617)
    expect(scanItemsTotal(scan({ taxCents: null, tipCents: null, discountCents: 50 }))).toBe(4400)
  })
})

describe('fillFromScan', () => {
  const draft = initialDraft(people)

  it('fills name, date and a by-item split with everyone on every line', () => {
    const fill = fillFromScan(scan(), all, { draft, currency: 'USD', memberIds: people })
    expect(fill.description).toBe("Joe's Diner")
    expect(fill.spentAt).toBe('2026-11-08')
    expect(fill.currency).toBeUndefined()
    expect(fill.draft?.mode).toBe('itemized')
    expect(fill.draft?.items.map((i) => [i.name, i.amountCents, i.userIds])).toEqual([
      ['2× Cheeseburger', 2500, people],
      ['Fries', 1950, people],
    ])
    expect([fill.draft?.taxCents, fill.draft?.tipCents, fill.draft?.tipPercent]).toEqual([
      367,
      800,
      null,
    ])
    expect(fill.amount).toBe(5617)
  })

  it('adds a line for whatever the receipt total has beyond its items', () => {
    const fill = fillFromScan(scan({ tipCents: null }), all, {
      draft,
      currency: 'USD',
      memberIds: people,
    })
    expect(fill.draft?.items.at(-1)).toMatchObject({ name: 'Everything else', amountCents: 800 })
    expect(itemsTotal(fill.draft!)).toBe(5617)
    expect(fill.amount).toBe(5617)
  })

  it('uses only the people already in the split', () => {
    const two = { ...draft, participants: ['me', 'ben'] }
    const fill = fillFromScan(scan(), all, { draft: two, currency: 'USD', memberIds: people })
    expect(fill.draft?.items[0]?.userIds).toEqual(['me', 'ben'])
    const nobody = { ...draft, participants: [] }
    const fallback = fillFromScan(scan(), all, {
      draft: nobody,
      currency: 'USD',
      memberIds: people,
    })
    expect(fallback.draft?.items[0]?.userIds).toEqual(people)
  })

  it('uses the total alone, leaving by item for an even split', () => {
    const itemized = { ...draft, mode: 'itemized' as const }
    const fill = fillFromScan(
      scan(),
      { ...all, items: false },
      { draft: itemized, currency: 'USD', memberIds: people },
    )
    expect(fill.amount).toBe(5617)
    expect(fill.draft?.mode).toBe('equal')
    const plain = fillFromScan(
      scan(),
      { ...all, items: false },
      {
        draft,
        currency: 'USD',
        memberIds: people,
      },
    )
    expect(plain.draft).toBeUndefined()
  })

  it('leaves out what was unticked, and switches currency only when amounts are used', () => {
    const yen = scan({ currency: 'JPY', totalCents: 507, items: [] })
    expect(
      fillFromScan(
        yen,
        { name: false, date: false, total: true, items: false },
        {
          draft,
          currency: 'USD',
          memberIds: people,
        },
      ),
    ).toEqual({ currency: 'JPY', amount: 507 })
    expect(
      fillFromScan(
        yen,
        { name: true, date: false, total: false, items: false },
        {
          draft,
          currency: 'USD',
          memberIds: people,
        },
      ),
    ).toEqual({ description: "Joe's Diner" })
  })
})
