import { paymentKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BEN, members, renderWithClient, seededClient } from '../expenses/test-utils'
import { PayWith } from './pay-with'

vi.mock('@/lib/supabase', () => import('../expenses/fake-supabase'))

const ben = members.find((m) => m.id === BEN)!

function renderPayWith(amountCents: number | null, onConfirmed = vi.fn()) {
  const client = seededClient((c) =>
    c.setQueryData(paymentKeys.methods(BEN), [
      { user_id: BEN, kind: 'paypal', handle: 'benokafor', updated_at: 'x' },
      { user_id: BEN, kind: 'interac', handle: 'ben@example.ca', updated_at: 'x' },
    ]),
  )
  renderWithClient(
    <>
      <PayWith recipient={ben} amountCents={amountCents} currency="USD" onConfirmed={onConfirmed} />
      <Toaster label="Notifications" />
    </>,
    client,
  )
  return onConfirmed
}

describe('PayWith', () => {
  it('links to the app with the amount, then asks before recording', async () => {
    const onConfirmed = renderPayWith(2050)
    expect(screen.getByText(t('settle.payWithTitle', { name: 'Ben' }))).toBeInTheDocument()
    const link = screen.getByRole('link', { name: t('settle.payWith', { app: 'PayPal' }) })
    expect(link).toHaveAttribute('href', 'https://paypal.me/benokafor/20.50USD')
    expect(link).toHaveAttribute('target', '_blank')
    expect(
      screen.getByText(t('settle.payWithPrefilled', { app: 'PayPal', amount: '$20.50' })),
    ).toBeInTheDocument()

    fireEvent.click(link)
    const dialog = await screen.findByRole('dialog', { name: t('settle.confirmTitle') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('settle.confirmYes') }))
    expect(onConfirmed).toHaveBeenCalled()
  })

  it('copies details for apps without links', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPayWith(2050)
    expect(screen.getByText('ben@example.ca')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: t('settle.copyLabel', { name: 'Ben', app: t('settle.apps.interac') }),
      }),
    )
    expect(await screen.findByText(t('settle.copied'))).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('ben@example.ca')
  })

  it('waits for an amount before opening anything', () => {
    const onConfirmed = renderPayWith(null)
    const link = screen.getByRole('link', { name: t('settle.payWith', { app: 'PayPal' }) })
    expect(link).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(link)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('lists links before details to copy, and UPI only for rupees', () => {
    const client = seededClient((c) =>
      c.setQueryData(paymentKeys.methods(BEN), [
        { user_id: BEN, kind: 'bank', handle: 'Sort code 12-34-56', updated_at: 'x' },
        { user_id: BEN, kind: 'upi', handle: 'ben@okhdfc', updated_at: 'x' },
        { user_id: BEN, kind: 'venmo', handle: 'Ben-Okafor', updated_at: 'x' },
      ]),
    )
    renderWithClient(
      <PayWith recipient={ben} amountCents={100} currency="USD" onConfirmed={() => {}} />,
      client,
    )
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Venmo')
    expect(rows[1]).toContain(t('settle.apps.bank'))
  })

  it('shows nothing when they saved no methods', () => {
    const client = seededClient((c) => c.setQueryData(paymentKeys.methods(BEN), []))
    const { container } = renderWithClient(
      <PayWith recipient={ben} amountCents={100} currency="USD" onConfirmed={() => {}} />,
      client,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
