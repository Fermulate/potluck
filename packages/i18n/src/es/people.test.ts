import { describe, expect, it } from 'vitest'
import { en } from '../en'
import { activityMember, errorCodes, friendNotification, helpTopics, people } from './people'

type Tree = { readonly [key: string]: string | Tree }

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  )
}

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

/** Spanish next to the English it translates, for every string this feature adds. */
const pairs: [string, string, Tree, Tree][] = [
  ['people', '', people, en.people],
  ['errors.codes', '', errorCodes, en.errors.codes as unknown as Tree],
  ['activity.member', '', activityMember, en.activity.member],
  ['notifications.types.friend', '', friendNotification, en.notifications.types.friend],
  ['help.topics', '', helpTopics, en.help.topics],
]

describe('Spanish for people and friends', () => {
  it.each(pairs)(
    '%s matches English key for key, placeholder for placeholder',
    (_name, _p, es, english) => {
      const englishLeaves = new Map(leaves(english))
      for (const [key, text] of leaves(es)) {
        expect(englishLeaves.has(key), key).toBe(true)
        expect(placeholders(text), key).toEqual(placeholders(englishLeaves.get(key)!))
      }
    },
  )

  it('translates every people string', () => {
    expect(leaves(people).map(([key]) => key)).toEqual(leaves(en.people).map(([key]) => key))
  })

  it('uses no em or en dashes', () => {
    for (const [, , es] of pairs) {
      for (const [key, text] of leaves(es)) expect(text, key).not.toMatch(DASHES)
    }
  })
})
