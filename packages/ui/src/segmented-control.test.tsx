import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { SegmentedControl } from './segmented-control'

type Split = 'equal' | 'exact' | 'percent' | 'shares'

function Harness({ disabled }: { disabled?: Split }) {
  const [value, setValue] = useState<Split>('equal')
  return (
    <>
      <button type="button">Before</button>
      <SegmentedControl
        label="Split type"
        value={value}
        onValueChange={setValue}
        options={[
          { value: 'equal', label: 'Equal' },
          { value: 'exact', label: 'Exact', disabled: disabled === 'exact' },
          { value: 'percent', label: 'Percent' },
          { value: 'shares', label: 'Shares' },
        ]}
      />
    </>
  )
}

describe('SegmentedControl', () => {
  it('is a labelled radio group with one checked option', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Split type' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Equal' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Percent' })).not.toBeChecked()
  })

  it('is a single tab stop on the selected option', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Before' }))
    await userEvent.tab()
    expect(screen.getByRole('radio', { name: 'Equal' })).toHaveFocus()
    await userEvent.tab()
    expect(document.body).toHaveFocus()
  })

  it('moves selection and focus with arrow keys and wraps around', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('radio', { name: 'Equal' }))
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Exact' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Exact' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Shares' })).toBeChecked()
  })

  it('jumps with Home and End', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('radio', { name: 'Equal' }))
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('radio', { name: 'Shares' })).toBeChecked()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('radio', { name: 'Equal' })).toBeChecked()
  })

  it('skips disabled options', async () => {
    render(<Harness disabled="exact" />)
    await userEvent.click(screen.getByRole('radio', { name: 'Equal' }))
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Percent' })).toBeChecked()
  })
})
