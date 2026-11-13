import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { stubPopover } from '@potluck/ui/test/popover'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

stubPopover()

// Radix measures switches and checkboxes with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

// Whole pages (router, query cache, a time zone picker with hundreds of options) can take more
// than a second to settle on a busy CI runner, past the default 1s that findBy and waitFor wait.
configure({ asyncUtilTimeout: 5_000 })
