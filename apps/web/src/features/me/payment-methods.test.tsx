import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, payloadOf, resetDb } from '@/test/supabase'
import { PaymentMethodsSection } from './payment-methods'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'u-ava' }))

function renderSection() {
  return renderWithProviders(
    <>
      <PaymentMethodsSection />
      <Toaster label="Notifications" />
    </>,
  )
}

describe('PaymentMethodsSection', () => {
  beforeEach(() =>
    resetDb({
      tables: {
        payment_methods: [{ user_id: VIEWER, kind: 'venmo', handle: 'Ava-Chen', updated_at: 'x' }],
      },
    }),
  )

  it('lists saved handles with their prefix', async () => {
    renderSection()
    expect(await screen.findByText('@Ava-Chen')).toBeInTheDocument()
    expect(screen.getByText(t('settle.apps.venmo'))).toBeInTheDocument()
  })

  it('cleans up a pasted link, checks it, and saves one handle per app', async () => {
    db().respond(
      'from:payment_methods',
      { data: [] },
      { data: { kind: 'paypal', handle: 'avamakes' } },
      { data: [] },
    )
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: t('settings.paymentMethods.add') }))
    const sheet = await screen.findByRole('dialog', { name: t('settings.paymentMethods.add') })
    fireEvent.click(within(sheet).getByRole('radio', { name: t('settle.apps.paypal') }))
    const field = within(sheet).getByLabelText(t('settings.paymentMethods.handle.paypal'))

    fireEvent.change(field, { target: { value: 'ava.makes' } })
    fireEvent.click(within(sheet).getByRole('button', { name: t('settings.paymentMethods.save') }))
    expect(
      await within(sheet).findByText(
        t('settings.paymentMethods.invalid', { app: t('settle.apps.paypal') }),
      ),
    ).toBeInTheDocument()

    fireEvent.change(field, { target: { value: 'https://paypal.me/avamakes' } })
    fireEvent.click(within(sheet).getByRole('button', { name: t('settings.paymentMethods.save') }))
    expect(
      await screen.findByText(t('settings.paymentMethods.saved', { app: t('settle.apps.paypal') })),
    ).toBeInTheDocument()
    const upsert = db()
      .queries('payment_methods')
      .find((q) => q.ops.some((op) => op.method === 'upsert'))!
    expect(payloadOf(upsert, 'upsert')).toEqual({ kind: 'paypal', handle: 'avamakes' })
  })

  it('changes and removes a handle', async () => {
    renderSection()
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('settings.paymentMethods.edit', { app: t('settle.apps.venmo') }),
      }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: t('settings.paymentMethods.edit', { app: t('settle.apps.venmo') }),
    })
    expect(within(sheet).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(sheet).getByLabelText(t('settings.paymentMethods.handle.venmo'))).toHaveValue(
      'Ava-Chen',
    )
    fireEvent.click(within(sheet).getByRole('button', { name: t('common.close') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(
      screen.getByRole('button', {
        name: t('settings.paymentMethods.remove', { app: t('settle.apps.venmo') }),
      }),
    )
    expect(
      await screen.findByText(
        t('settings.paymentMethods.removed', { app: t('settle.apps.venmo') }),
      ),
    ).toBeInTheDocument()

    // Undo saves the same handle again.
    fireEvent.click(screen.getByRole('button', { name: t('common.undo') }))
    await waitFor(() =>
      expect(
        db()
          .queries('payment_methods')
          .some((q) => q.ops.some((op) => op.method === 'upsert')),
      ).toBe(true),
    )
    const upsert = db()
      .queries('payment_methods')
      .find((q) => q.ops.some((op) => op.method === 'upsert'))!
    expect(payloadOf(upsert, 'upsert')).toEqual({ kind: 'venmo', handle: 'Ava-Chen' })
  })
})
