import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { stubPopover } from '@potluck/ui/test/popover'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

stubPopover()
