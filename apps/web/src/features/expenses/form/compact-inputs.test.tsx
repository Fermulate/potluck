import { MoneyInput } from '@potluck/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CompactMoneyInput, PercentInput } from './compact-inputs'

function MoneyHarness({ locale, currency = 'EUR' }: { locale: string; currency?: string }) {
  const [compact, setCompact] = useState<number | null>(null)
  const [big, setBig] = useState<number | null>(null)
  const [code, setCode] = useState(currency)
  return (
    <>
      <CompactMoneyInput
        aria-label="Line"
        value={compact}
        onValueChange={setCompact}
        currency={code}
        locale={locale}
      />
      <MoneyInput
        label="Total"
        value={big}
        onValueChange={setBig}
        currency={code}
        locale={locale}
      />
      <output aria-label="line cents">{compact ?? 'empty'}</output>
      <output aria-label="total cents">{big ?? 'empty'}</output>
      <button type="button" onClick={() => setCode('JPY')}>
        Yen
      </button>
    </>
  )
}

function type(name: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
}

function typeBoth(text: string) {
  type('Line', text)
  type('Total', text)
}

describe('CompactMoneyInput', () => {
  it('reads "12,50" as twelve fifty in German, like the main amount field', () => {
    render(<MoneyHarness locale="de-DE" />)
    typeBoth('12,50')
    expect(screen.getByRole('textbox', { name: 'Line' })).toHaveValue('12,50')
    expect(screen.getByRole('status', { name: 'line cents' })).toHaveTextContent('1250')
    expect(screen.getByRole('status', { name: 'total cents' })).toHaveTextContent('1250')
  })

  it('treats a comma as grouping in US English and shows what it parsed', () => {
    render(<MoneyHarness locale="en-US" currency="USD" />)
    typeBoth('12,50')
    // The comma is dropped from the text, so the field never shows a value it did not parse.
    expect(screen.getByRole('textbox', { name: 'Line' })).toHaveValue('1250')
    expect(screen.getByRole('status', { name: 'line cents' })).toHaveTextContent('125000')
    expect(screen.getByRole('status', { name: 'total cents' })).toHaveTextContent('125000')
  })

  it('reads a typed dot as the decimal point in both locales', () => {
    render(<MoneyHarness locale="de-DE" />)
    type('Line', '7.5')
    expect(screen.getByRole('textbox', { name: 'Line' })).toHaveValue('7,5')
    expect(screen.getByRole('status', { name: 'line cents' })).toHaveTextContent('750')
  })

  it('redraws its text when the currency changes', () => {
    render(<MoneyHarness locale="en-US" currency="USD" />)
    const line = screen.getByRole('textbox', { name: 'Line' })
    type('Line', '10.50')
    expect(screen.getByRole('status', { name: 'line cents' })).toHaveTextContent('1050')
    fireEvent.click(screen.getByRole('button', { name: 'Yen' }))
    // Same minor units, now whole yen: the field must not keep showing "10.50".
    expect(line).toHaveValue('1050')
    expect(screen.getByRole('status', { name: 'line cents' })).toHaveTextContent('1050')
  })

  it('uses the currency precision from the shared table', () => {
    render(<MoneyHarness locale="en-US" currency="HUF" />)
    type('Line', '1500')
    expect(screen.getByRole('status', { name: 'line cents' })).toHaveTextContent('150000')
  })
})

describe('PercentInput', () => {
  function renderPercent(locale: string, basisPoints = 5000) {
    const onCommit = vi.fn()
    render(
      <PercentInput
        aria-label="Share"
        basisPoints={basisPoints}
        onCommit={onCommit}
        locale={locale}
      />,
    )
    return { onCommit, input: screen.getByRole('textbox', { name: 'Share' }) }
  }

  it('reads "12,50" as 12.5% in German', () => {
    const { onCommit, input } = renderPercent('de-DE')
    fireEvent.change(input, { target: { value: '12,50' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenLastCalledWith(1250)
  })

  it('agrees with the money fields in US English', () => {
    const { onCommit, input } = renderPercent('en-US')
    fireEvent.change(input, { target: { value: '12,5' } })
    expect(input).toHaveValue('125')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenLastCalledWith(12500)
  })

  it('shows the value with the locale decimal mark', () => {
    expect(renderPercent('de-DE', 3333).input).toHaveValue('33,33')
  })

  it('commits an emptied field as 0%', () => {
    const { onCommit, input } = renderPercent('en-US')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenLastCalledWith(0)
  })
})
