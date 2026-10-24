import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GROUP_EMOJIS } from './group-emojis'
import { EmojiPicker } from './group-form-fields'

const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'
const flag = '\u{1F1E8}\u{1F1E6}'
const keycap = '1️⃣'

function typeCustom(text: string, before = '') {
  const onChange = vi.fn()
  const view = render(<EmojiPicker value={before} onChange={onChange} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Or type your own' }), {
    target: { value: text },
  })
  view.unmount()
  return onChange
}

describe('EmojiPicker custom emoji', () => {
  it('keeps a compound emoji whole', () => {
    expect(typeCustom(family)).toHaveBeenCalledWith(family)
    expect(typeCustom(flag)).toHaveBeenCalledWith(flag)
    expect(typeCustom(keycap)).toHaveBeenCalledWith(keycap)
  })

  it('keeps only the first character of a longer paste', () => {
    expect(typeCustom(`${family}${flag}`)).toHaveBeenCalledWith(family)
    expect(typeCustom(' ab ')).toHaveBeenCalledWith('a')
  })

  it('falls back to the first preset when the box is cleared', () => {
    expect(typeCustom('', flag)).toHaveBeenCalledWith(GROUP_EMOJIS[0])
  })
})
