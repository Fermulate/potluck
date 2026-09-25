import { CATEGORY_IDS, SPLIT_TYPES } from '@potluck/core'
import { describe, expect, it } from 'vitest'
import { en, hasMessage } from './index'

function leaves(node: object, prefix = ''): [string, string][] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [[path, value] as [string, string]] : leaves(value, path)
  })
}

const all = leaves(en)

describe('the English dictionary', () => {
  it('never uses em or en dashes', () => {
    const offenders = all.filter(([, text]) => /[\u2013\u2014]/.test(text)).map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('has well formed placeholders', () => {
    const offenders = all
      .filter(([, text]) => {
        const stripped = text.replace(/\{\w+\}/g, '')
        return stripped.includes('{') || stripped.includes('}')
      })
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('pairs every _one form with an _other form', () => {
    const keys = new Set(all.map(([key]) => key))
    const orphans = [...keys]
      .filter((key) => /_(zero|one)$/.test(key))
      .filter((key) => !keys.has(key.replace(/_(zero|one)$/, '_other')))
    expect(orphans).toEqual([])
  })

  it('uses {count} in every plural _other form', () => {
    const missing = all
      .filter(([key, text]) => key.endsWith('_other') && !text.includes('{count}'))
      .map(([key]) => key)
    expect(missing).toEqual([])
  })

  it('has no blank strings', () => {
    expect(all.filter(([, text]) => text.trim() === '').map(([key]) => key)).toEqual([])
  })
})

const missingKeys = (keys: string[]) => keys.filter((key) => !hasMessage(key))

describe('coverage of core domain values', () => {
  it('labels every expense category', () => {
    expect(missingKeys(CATEGORY_IDS.map((id) => `categories.${id}`))).toEqual([])
  })

  it('labels and explains every split type', () => {
    expect(
      missingKeys(
        SPLIT_TYPES.flatMap((type) => [`splitTypes.${type}.label`, `splitTypes.${type}.hint`]),
      ),
    ).toEqual([])
  })

  it('names and describes every group role', () => {
    expect(
      missingKeys(
        (['owner', 'admin', 'member'] as const).flatMap((role) => [
          `roles.${role}.label`,
          `roles.${role}.description`,
        ]),
      ),
    ).toEqual([])
  })
})
