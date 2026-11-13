import { hasMessage } from '@potluck/i18n'
import { describe, expect, it } from 'vitest'
import { HELP_PAGES, HELP_TOPICS } from './topics'

// Every page the guide publishes. A help link to anything else would land on a 404.
const GUIDE_PAGES = new Set([
  '/',
  '/getting-started/',
  '/groups/',
  '/groups/invites/',
  '/groups/roles/',
  '/groups/settings/',
  '/friends/',
  '/expenses/',
  '/expenses/splits/',
  '/expenses/currencies/',
  '/expenses/recurring/',
  '/expenses/receipts/',
  '/expenses/editing/',
  '/expenses/search-and-totals/',
  '/balances/',
  '/balances/settle-up/',
  '/plans/',
  '/plans/availability/',
  '/plans/best-time/',
  '/plans/lock-in/',
  '/plans/timeline/',
  '/notifications/',
  '/account/',
  '/privacy-and-security/',
  '/faq/',
  '/troubleshooting/',
])

describe('help topics', () => {
  it('point at real guide pages with heading anchors', () => {
    for (const [topic, path] of Object.entries(HELP_TOPICS)) {
      const [page, anchor] = path.split('#')
      expect(GUIDE_PAGES.has(page!), `${topic}: ${page}`).toBe(true)
      expect(anchor, topic).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
    for (const page of Object.values(HELP_PAGES)) expect(GUIDE_PAGES.has(page)).toBe(true)
  })

  it('each have a label for the link', () => {
    const missing = Object.keys(HELP_TOPICS).filter((topic) => !hasMessage(`help.topics.${topic}`))
    expect(missing).toEqual([])
  })
})
