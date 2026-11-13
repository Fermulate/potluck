import { t } from '@potluck/i18n'
import { fireEvent, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { FilterSheet } from './filter-sheet'
import type { MoneyFilters } from './filter-state'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function Sheet({ today, initial = {} }: { today: string; initial?: MoneyFilters }) {
  const [filters, setFilters] = useState<MoneyFilters>(initial)
  return (
    <FilterSheet
      open
      onOpenChange={() => {}}
      filters={filters}
      onChange={setFilters}
      today={today}
      people={[]}
    />
  )
}

async function pickCustom() {
  const sheet = await screen.findByRole('dialog', { name: t('filters.title') })
  fireEvent.click(within(sheet).getByRole('button', { name: t('filters.custom') }))
  return sheet
}

describe('FilterSheet dates', () => {
  it('opens custom dates from a preset, keeping its range to start from', async () => {
    renderWithProviders(
      <Sheet today="2026-03-15" initial={{ from: '2026-03-01', to: '2026-03-31' }} />,
    )
    const sheet = await pickCustom()
    expect(within(sheet).getByLabelText(t('filters.from'))).toHaveValue('2026-03-01')
    expect(within(sheet).getByLabelText(t('filters.to'))).toHaveValue('2026-03-31')
    expect(within(sheet).getByRole('button', { name: t('filters.thisMonth') })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    fireEvent.click(within(sheet).getByRole('button', { name: t('filters.thisMonth') }))
    expect(within(sheet).queryByLabelText(t('filters.from'))).not.toBeInTheDocument()
  })

  it('opens custom dates on the last day of a month, when the default range is this month', async () => {
    renderWithProviders(<Sheet today="2026-03-31" />)
    const sheet = await pickCustom()
    expect(within(sheet).getByLabelText(t('filters.from'))).toHaveValue('2026-03-01')
    expect(within(sheet).getByLabelText(t('filters.to'))).toHaveValue('2026-03-31')
  })
})
