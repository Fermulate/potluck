import { CATEGORIES, subcategoriesOf, type CategoryId } from '@potluck/core'
import { t } from '@potluck/i18n'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { categoryLabel } from '../format'
import { CategoryPicker } from './category-picker'

function Harness({ start = null }: { start?: CategoryId | null }) {
  const [value, setValue] = useState<CategoryId | null>(start)
  return (
    <>
      <button type="button">Before</button>
      <CategoryPicker value={value} onChange={setValue} />
      <button type="button">After</button>
      <output aria-label="picked">{value ?? 'none'}</output>
    </>
  )
}

const row = () => screen.getByRole('radiogroup', { name: t('categories.label') })
const chip = (id: CategoryId) => within(row()).getByRole('radio', { name: categoryLabel(id) })
const picked = () => screen.getByRole('status', { name: 'picked' }).textContent
const tabStops = (group: HTMLElement) =>
  within(group)
    .getAllByRole('radio')
    .filter((r) => r.tabIndex === 0)

describe('CategoryPicker keyboard', () => {
  it('is one Tab stop: the first chip when nothing is picked, else the picked one', () => {
    const { unmount } = render(<Harness />)
    expect(tabStops(row())).toEqual([chip(CATEGORIES[0]!.id)])
    unmount()

    render(<Harness start={CATEGORIES[3]!.id} />)
    expect(tabStops(row())).toEqual([chip(CATEGORIES[3]!.id)])
  })

  it('moves along the row with the arrow keys and picks as it goes, wrapping at the ends', () => {
    render(<Harness />)
    const first = CATEGORIES[0]!.id
    const second = CATEGORIES[1]!.id
    const last = CATEGORIES[CATEGORIES.length - 1]!.id

    chip(first).focus()
    fireEvent.keyDown(chip(first), { key: 'ArrowRight' })
    expect(picked()).toBe(second)
    expect(chip(second)).toHaveFocus()
    expect(chip(second)).toHaveAttribute('aria-checked', 'true')
    expect(tabStops(row())).toEqual([chip(second)])

    fireEvent.keyDown(chip(second), { key: 'ArrowLeft' })
    fireEvent.keyDown(chip(first), { key: 'ArrowLeft' })
    expect(picked()).toBe(last)
    expect(chip(last)).toHaveFocus()

    fireEvent.keyDown(chip(last), { key: 'Home' })
    expect(picked()).toBe(first)
    fireEvent.keyDown(chip(first), { key: 'End' })
    expect(picked()).toBe(last)
  })

  it('gives the subcategory row its own single Tab stop and arrow keys', () => {
    const parent = CATEGORIES.find((c) => subcategoriesOf(c.id).length > 1)!.id
    const subs = subcategoriesOf(parent)
    render(<Harness start={parent} />)
    const subRow = screen.getByRole('radiogroup', { name: t('categories.subLabel') })
    const subChip = (i: number) =>
      within(subRow).getByRole('radio', { name: categoryLabel(subs[i]!.id) })

    expect(tabStops(subRow)).toEqual([subChip(0)])
    fireEvent.keyDown(subChip(0), { key: 'ArrowRight' })
    expect(picked()).toBe(subs[1]!.id)
    expect(subChip(1)).toHaveFocus()
    // The top row still has the parent as its one stop.
    expect(tabStops(row())).toEqual([chip(parent)])
  })
})
