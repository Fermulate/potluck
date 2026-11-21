import { useState } from 'react'

const hiddenKey = (userId: string) => `potluck:first-steps-hidden:${userId}`

function readHidden(userId: string): boolean {
  try {
    return window.localStorage.getItem(hiddenKey(userId)) === '1'
  } catch {
    return false
  }
}

/** Whether this person hid the first steps card in this browser, and the way to hide it. */
export function useFirstStepsHidden(userId: string): [boolean, () => void] {
  const [hidden, setHidden] = useState(() => readHidden(userId))
  const hide = () => {
    setHidden(true)
    try {
      window.localStorage.setItem(hiddenKey(userId), '1')
    } catch {
      // Private mode: it stays hidden for this visit only.
    }
  }
  return [hidden, hide]
}
