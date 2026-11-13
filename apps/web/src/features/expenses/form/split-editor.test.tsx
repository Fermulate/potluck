import { t } from '@potluck/i18n'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BEN, CLEO, ME, members } from '../test-utils'
import { SplitEditor } from './split-editor'
import { initialDraft, type SplitDraft } from './split-state'

vi.mock('@/lib/supabase', () => import('../fake-supabase'))

function Harness({ mode, onAddPerson }: { mode: SplitDraft['mode']; onAddPerson?: () => void }) {
  const [draft, setDraft] = useState<SplitDraft>(() => ({
    ...initialDraft(members.map((m) => m.id)),
    mode,
  }))
  return (
    <>
      <SplitEditor
        members={members}
        viewerId={ME}
        draft={draft}
        onChange={setDraft}
        amountCents={9000}
        currency="EUR"
        locale="de-DE"
        onAddPerson={onAddPerson}
      />
      <output aria-label="draft">{JSON.stringify(draft)}</output>
    </>
  )
}

function draft(): SplitDraft {
  return JSON.parse(screen.getByRole('status', { name: 'draft' }).textContent ?? '') as SplitDraft
}

function type(name: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
}

// A German reader types "12,50" for twelve and a half, so every field in the editor must read
// it that way, not as the US "1250".
describe('SplitEditor locale', () => {
  it('reads exact amounts in the given locale', () => {
    render(<Harness mode="exact" />)
    type('You, amount', '12,50')
    expect(screen.getByRole('textbox', { name: 'You, amount' })).toHaveValue('12,50')
    expect(draft().exact[ME]).toBe(1250)
  })

  it('reads percents in the given locale', () => {
    render(<Harness mode="percent" />)
    const you = screen.getByRole('textbox', { name: 'You, percent' })
    fireEvent.change(you, { target: { value: '12,5' } })
    fireEvent.blur(you)
    expect(draft().percent[ME]).toBe(1250)
    expect(draft().percent[BEN]! + draft().percent[CLEO]!).toBe(8750)
  })

  it('reads item prices, tax and tip in the given locale', () => {
    render(<Harness mode="itemized" />)
    type('Price, Item 1', '12,50')
    fireEvent.change(screen.getByLabelText('Tax'), { target: { value: '1,25' } })
    fireEvent.change(screen.getByLabelText('Tip'), { target: { value: '2,5' } })
    expect(draft().items[0]!.amountCents).toBe(1250)
    expect(draft().taxCents).toBe(125)
    expect(draft().tipCents).toBe(250)
  })
})

describe('SplitEditor people', () => {
  it('offers adding someone new only when the form can', () => {
    const { unmount } = render(<Harness mode="equal" />)
    expect(screen.queryByRole('button', { name: t('people.placeholder.addToSplit') })).toBeNull()
    unmount()
    const onAddPerson = vi.fn()
    render(<Harness mode="equal" onAddPerson={onAddPerson} />)
    fireEvent.click(screen.getByRole('button', { name: t('people.placeholder.addToSplit') }))
    expect(onAddPerson).toHaveBeenCalledOnce()
  })
})
