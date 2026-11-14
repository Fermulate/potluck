import { describe, expect, it } from 'vitest'
import { blockedOnExpense } from './block-conflict'

const blocked = new Set(['dee'])

describe('blockedOnExpense', () => {
  it('names someone the viewer blocked on a new expense with them', () => {
    expect(blockedOnExpense('ava', ['ava', 'dee', 'ben'], null, blocked)).toEqual(['dee'])
  })

  it('is empty when the viewer is not on the expense themselves', () => {
    expect(blockedOnExpense('ava', ['dee', 'ben'], null, blocked)).toEqual([])
  })

  it('is empty with no blocks, or without the blocked person', () => {
    expect(blockedOnExpense('ava', ['ava', 'dee'], null, new Set())).toEqual([])
    expect(blockedOnExpense('ava', ['ava', 'ben'], null, blocked)).toEqual([])
  })

  it('leaves an older expense both were already on alone, as the server does', () => {
    expect(blockedOnExpense('ava', ['ava', 'dee'], ['ava', 'dee'], blocked)).toEqual([])
  })

  it('flags an edit that brings either of the two in', () => {
    expect(blockedOnExpense('ava', ['ava', 'dee'], ['ava'], blocked)).toEqual(['dee'])
    expect(blockedOnExpense('ava', ['ava', 'dee'], ['dee'], blocked)).toEqual(['dee'])
  })
})
