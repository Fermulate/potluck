import { moneyKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '@/test/supabase'
import { renderWithClient, seededClient } from '../test-utils'
import { ConversionPreview } from './conversion-preview'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const DAY = '2026-11-04'

function renderPreview(
  props: Partial<Parameters<typeof ConversionPreview>[0]> = {},
  rate?: { rate: number; day: string } | null,
) {
  const client = seededClient((c) => {
    if (rate !== undefined) c.setQueryData(moneyKeys.fxRate('EUR', 'USD', DAY), rate)
  })
  return renderWithClient(
    <ConversionPreview
      amountCents={10000}
      currency="EUR"
      groupCurrency="USD"
      spentAt={DAY}
      {...props}
    />,
    client,
  )
}

describe('ConversionPreview', () => {
  beforeEach(() => {
    resetDb()
  })

  it('previews the amount in the group currency at the latest rate', () => {
    renderPreview({}, { rate: 1.08, day: '2026-11-03' })
    expect(
      screen.getByText(t('expenses.conversion.about', { amount: '$108.00', currency: 'USD' })),
    ).toBeInTheDocument()
    expect(screen.getByText(/1\.08/)).toHaveTextContent(t('expenses.conversion.locked'))
  })

  it('keeps the saved rate of an edited expense', () => {
    renderPreview({ savedRate: 1.123456 })
    expect(
      screen.getByText(
        t('expenses.conversion.savedRate', { from: 'EUR', to: 'USD', rate: '1.1235' }),
      ),
    ).toBeInTheDocument()
  })

  it('warns when there is no rate for that currency', () => {
    renderPreview({}, null)
    expect(screen.getByRole('alert')).toHaveTextContent(
      t('expenses.conversion.unavailable', { from: 'EUR', to: 'USD' }),
    )
  })

  it('says nothing for the group currency', () => {
    const { container } = renderPreview({ currency: 'USD' }, null)
    expect(container).toBeEmptyDOMElement()
  })
})
