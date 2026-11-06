import { describe, expect, it, vi } from 'vitest'
import { leftoverPlaceholder, missingEnv, requireEnv } from './require-env'

const complete = {
  VITE_SUPABASE_URL: 'https://abc.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_123',
  VITE_APP_URL: 'https://potluck.example',
}

type Hook = (this: { error: (message: string) => never }, ...args: unknown[]) => void

function run(hook: unknown, ...args: unknown[]) {
  const error = vi.fn((message: string) => {
    throw new Error(message)
  })
  ;(hook as Hook).call({ error: error as never }, ...args)
}

describe('missingEnv', () => {
  it('names what is missing or blank', () => {
    expect(missingEnv(complete)).toEqual([])
    expect(missingEnv({ ...complete, VITE_APP_URL: '  ' })).toEqual(['VITE_APP_URL'])
    expect(missingEnv({})).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'VITE_APP_URL',
    ])
  })
})

describe('leftoverPlaceholder', () => {
  it('finds an unreplaced env placeholder', () => {
    expect(leftoverPlaceholder('<meta content="%VITE_APP_URL%/" />')).toBe('%VITE_APP_URL%')
    expect(leftoverPlaceholder('<meta content="https://potluck.example/" />')).toBeNull()
  })
})

describe('requireEnv', () => {
  it('fails a production build with missing variables', () => {
    const plugin = requireEnv('production', { VITE_SUPABASE_URL: complete.VITE_SUPABASE_URL })
    expect(plugin.apply).toBe('build')
    expect(() => run(plugin.buildStart)).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY, VITE_APP_URL/)
  })

  it('lets a complete production build through', () => {
    expect(() => run(requireEnv('production', complete).buildStart)).not.toThrow()
  })

  it('leaves dev and test builds alone', () => {
    expect(() => run(requireEnv('development', {}).buildStart)).not.toThrow()
    expect(() => run(requireEnv('test', {}).buildStart)).not.toThrow()
  })

  it('refuses to ship HTML with a placeholder left in it', () => {
    const plugin = requireEnv('development', {})
    const html = (source: string) => ({
      'index.html': { type: 'asset', fileName: 'index.html', source },
      'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: '"%VITE_X%"' },
    })
    expect(() => run(plugin.writeBundle, {}, html('<meta content="%VITE_APP_URL%/">'))).toThrow(
      /index\.html still contains %VITE_APP_URL%/,
    )
    expect(() =>
      run(plugin.writeBundle, {}, html('<meta content="https://a.test/">')),
    ).not.toThrow()
  })
})
