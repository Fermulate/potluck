import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Field } from './field'
import { formatMoneyInput, MoneyInput, parseMoneyInput } from './money-input'

describe('parseMoneyInput', () => {
  it('turns typed text into cents', () => {
    expect(parseMoneyInput('12.5', 'USD', 'en-US')).toBe(1250)
    expect(parseMoneyInput('0.07', 'USD', 'en-US')).toBe(7)
    expect(parseMoneyInput('1,234.56', 'USD', 'en-US')).toBe(123456)
    expect(parseMoneyInput('', 'USD', 'en-US')).toBeNull()
  })

  it('understands a comma decimal separator', () => {
    expect(parseMoneyInput('12,5', 'EUR', 'de-DE')).toBe(1250)
    expect(parseMoneyInput('12.5', 'EUR', 'de-DE')).toBe(1250)
  })

  it('drops dot grouping in comma decimal locales', () => {
    expect(parseMoneyInput('1.234,56', 'EUR', 'de-DE')).toBe(123456)
  })

  it('handles currencies without cents', () => {
    expect(parseMoneyInput('1500', 'JPY', 'ja-JP')).toBe(1500)
  })

  it('scales by the ISO minor units, so forints keep two decimals', () => {
    expect(parseMoneyInput('1500', 'HUF', 'en-US')).toBe(150000)
    expect(parseMoneyInput('2.5', 'IQD', 'en-US')).toBe(2500)
  })
})

describe('formatMoneyInput', () => {
  it('writes minor units back as editable text in the locale', () => {
    expect(formatMoneyInput(1250, 'USD', 'en-US')).toBe('12.50')
    expect(formatMoneyInput(1250, 'EUR', 'de-DE')).toBe('12,50')
    expect(formatMoneyInput(2000, 'USD', 'en-US')).toBe('20')
    expect(formatMoneyInput(1500, 'JPY', 'en-US')).toBe('1500')
    expect(formatMoneyInput(null, 'USD', 'en-US')).toBe('')
  })
})

function Harness({
  initial = null,
  locale = 'en-US',
}: {
  initial?: number | null
  locale?: string
}) {
  const [cents, setCents] = useState<number | null>(initial)
  const [currency, setCurrency] = useState(locale === 'de-DE' ? 'EUR' : 'USD')
  return (
    <>
      <Field label="Amount">
        <MoneyInput value={cents} onValueChange={setCents} currency={currency} locale={locale} />
      </Field>
      <output>{cents === null ? 'empty' : cents}</output>
      <button type="button" onClick={() => setCents(2000)}>
        Twenty
      </button>
      <button type="button" onClick={() => setCurrency('JPY')}>
        Yen
      </button>
    </>
  )
}

describe('MoneyInput', () => {
  it('reports cents as you type and caps decimals', async () => {
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Amount' })
    await userEvent.type(input, '42.509')
    expect(input).toHaveValue('42.50')
    expect(screen.getByRole('status')).toHaveTextContent('4250')
  })

  it('ignores letters and a second separator', async () => {
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Amount' })
    await userEvent.type(input, '1a2.3.4')
    expect(input).toHaveValue('12.34')
  })

  it('follows values set by the parent', async () => {
    render(<Harness initial={150} />)
    const input = screen.getByRole('textbox', { name: 'Amount' })
    expect(input).toHaveValue('1.50')
    await userEvent.click(screen.getByRole('button', { name: 'Twenty' }))
    expect(input).toHaveValue('20')
  })

  it('reads a pasted German amount with grouping', async () => {
    render(<Harness locale="de-DE" />)
    const input = screen.getByRole('textbox', { name: 'Amount' })
    await userEvent.click(input)
    await userEvent.paste('1.234,56')
    expect(input).toHaveValue('1234,56')
    expect(screen.getByRole('status')).toHaveTextContent(/^123456$/)
  })

  it('reformats the text when the currency changes', async () => {
    render(<Harness initial={4250} />)
    const input = screen.getByRole('textbox', { name: 'Amount' })
    expect(input).toHaveValue('42.50')
    await userEvent.click(screen.getByRole('button', { name: 'Yen' }))
    expect(input).toHaveValue('4250')
    await userEvent.type(input, '{Backspace}')
    expect(input).toHaveValue('425')
    expect(screen.getByRole('status')).toHaveTextContent(/^425$/)
  })
})
