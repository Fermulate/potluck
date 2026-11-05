import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Field } from './field'
import { MoneyInput, parseMoneyInput } from './money-input'

describe('parseMoneyInput', () => {
  it('turns typed text into cents', () => {
    expect(parseMoneyInput('12.5', 'USD', 'en-US')).toBe(1250)
    expect(parseMoneyInput('0.07', 'USD', 'en-US')).toBe(7)
    expect(parseMoneyInput('1,234.56', 'USD', 'en-US')).toBe(123456)
    expect(parseMoneyInput('', 'USD', 'en-US')).toBeNull()
  })

  it('understands a comma decimal separator', () => {
    expect(parseMoneyInput('12,5', 'EUR', 'de-DE')).toBe(1250)
  })

  it('handles currencies without cents', () => {
    expect(parseMoneyInput('1500', 'JPY', 'ja-JP')).toBe(1500)
  })
})

function Harness({ initial = null }: { initial?: number | null }) {
  const [cents, setCents] = useState<number | null>(initial)
  return (
    <>
      <Field label="Amount">
        <MoneyInput value={cents} onValueChange={setCents} currency="USD" locale="en-US" />
      </Field>
      <output>{cents === null ? 'empty' : cents}</output>
      <button type="button" onClick={() => setCents(2000)}>
        Twenty
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
})
