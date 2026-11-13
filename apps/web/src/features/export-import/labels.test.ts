import { ledgerCsv, readImportFile } from '@potluck/core'
import { LOCALE_CODES, setLocale } from '@potluck/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { categoryLabel } from '@/features/expenses/format'
import { importLabelSets, ledgerLabels } from './labels'

const AVA = 'aaaaaaaa-0000-4000-8000-000000000001'
const BEN = 'bbbbbbbb-0000-4000-8000-000000000002'

function exported(categories: (string | null)[]): string {
  return ledgerCsv(
    [
      {
        name: 'Trip',
        currency: 'USD',
        expenses: categories.map((category, i) => ({
          description: `Row ${i}`,
          category,
          notes: null,
          spentAt: `2026-03-0${i + 1}`,
          createdAt: `2026-03-0${i + 1}T10:00:00Z`,
          amountCents: 1000,
          currency: 'USD',
          fxRate: '1',
          isRefund: false,
          payers: [{ userId: AVA, paidCents: 1000 }],
          splits: [
            { userId: AVA, shareCents: 500 },
            { userId: BEN, shareCents: 500 },
          ],
        })),
        payments: [],
      },
    ],
    {
      labels: ledgerLabels(),
      people: [
        { id: AVA, name: 'Ava Chen' },
        { id: BEN, name: 'Ben Okafor' },
      ],
      paymentText: () => '',
      categoryLabel,
    },
  )
}

const imported = (csv: string) =>
  readImportFile(csv, importLabelSets())
    .entries.slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => e.category)

describe('CSV category labels', () => {
  afterEach(() => setLocale('en'))

  it('reads back every category and subcategory a Potluck export wrote', () => {
    const ids = ['food', 'dining_out', 'public_transit', 'household_supplies', 'taxi']
    expect(imported(exported(ids))).toEqual(ids)
  })

  it('reads an English export after switching language, and one written in that language', async () => {
    const english = exported(['dining_out', 'wine_spirits'])
    await setLocale('de')
    expect(imported(english)).toEqual(['dining_out', 'wine_spirits'])
    expect(imported(exported(['public_transit', 'transport']))).toEqual([
      'public_transit',
      'transport',
    ])
  })

  it.each(LOCALE_CODES)('names every category and subcategory differently in %s', async (code) => {
    await setLocale(code)
    const names = Object.values(ledgerLabels().categories)
    const repeated = names.filter((name, i) => names.indexOf(name) !== i)
    expect(repeated).toEqual([])
  })

  it('reads a Spanish utilities expense back as utilities, not home services', async () => {
    await setLocale('es')
    expect(imported(exported(['utilities', 'services']))).toEqual(['utilities', 'services'])
  })
})
