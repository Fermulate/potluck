import type { KeyboardEvent } from 'react'

/**
 * Enter without Shift, and not the Enter that confirms an IME composition (Japanese, Chinese,
 * Korean input). Safari ends the composition before the keydown, so it is spotted by the 229
 * key code instead of `isComposing`.
 */
export function isSendEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  )
}
