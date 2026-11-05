import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Field } from './field'
import { Select, type SelectOption } from './select'

const currencies: SelectOption[] = [
  { value: 'EUR', label: 'Euro', icon: <svg data-testid="eur" /> },
  { value: 'USD', label: 'US dollar' },
  { value: 'GBP', label: <b>Pound</b>, textValue: 'Pound' },
  { value: 'JPY', label: 'Yen', disabled: true },
]

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<string>()
  return (
    <Select
      label="Currency"
      placeholder="Pick one"
      options={currencies}
      value={value}
      onValueChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

describe('Select', () => {
  it('is a named combobox showing the placeholder', () => {
    render(<Harness />)
    const trigger = screen.getByRole('combobox', { name: 'Currency' })
    expect(trigger).toHaveTextContent('Pick one')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a listbox and picks an option', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Currency' }))

    const listbox = await screen.findByRole('listbox')
    expect(listbox).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(4)
    expect(screen.getByRole('option', { name: 'Yen' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('eur').parentElement).toHaveAttribute('aria-hidden', 'true')

    await userEvent.click(screen.getByRole('option', { name: 'US dollar' }))

    expect(onChange).toHaveBeenCalledWith('USD')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('US dollar')
  })

  it('marks the current value as selected', async () => {
    render(<Select label="Currency" options={currencies} defaultValue="GBP" />)
    const trigger = screen.getByRole('combobox', { name: 'Currency' })
    expect(trigger).toHaveTextContent('Pound')
    await userEvent.click(trigger)
    expect(await screen.findByRole('option', { name: 'Pound' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('takes its name and description from a surrounding Field', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Field label="Group currency" hint="Used for new expenses" error="Pick a currency">
        <Select ref={ref} options={currencies} label="ignored" />
      </Field>,
    )
    const trigger = screen.getByRole('combobox', { name: 'Group currency' })
    expect(trigger).toHaveAccessibleDescription('Pick a currency')
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(ref.current).toBe(trigger)
  })

  it('cannot be opened when disabled', async () => {
    render(<Select label="Currency" options={currencies} disabled />)
    const trigger = screen.getByRole('combobox', { name: 'Currency' })
    expect(trigger).toBeDisabled()
    await userEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
