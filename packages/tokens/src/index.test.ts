import { describe, expect, it } from 'vitest'
import {
  avatarColor,
  avatarPalette,
  contrastRatio,
  darkTheme,
  heatLevel,
  lightTheme,
  palette,
  themes,
  toCssRule,
  toCssVariables,
  type ThemeColors,
} from './index'

const AA = 4.5

describe('palette', () => {
  it('keeps the brand hues from the design doc', () => {
    expect(palette.paper).toBe('#fbf5ea')
    expect(palette.ink).toBe('#1d1a16')
    expect(palette.tomato).toBe('#e8492f')
    expect(palette.saffron).toBe('#f5b53d')
  })
})

describe.each(Object.values(themes))('$name theme contrast', (theme) => {
  const c: ThemeColors = theme.colors
  const textPairs: Array<[string, string, string]> = [
    ['ink on paper', c.ink, c.paper],
    ['ink on card', c.ink, c.card],
    ['ink on sunken', c.ink, c.sunken],
    ['mute on paper', c.mute, c.paper],
    ['mute on card', c.mute, c.card],
    ['tomatoInk on paper', c.tomatoInk, c.paper],
    ['tomatoInk on card', c.tomatoInk, c.card],
    ['saffronInk on paper', c.saffronInk, c.paper],
    ['saffronInk on card', c.saffronInk, c.card],
    ['oliveInk on paper', c.oliveInk, c.paper],
    ['oliveInk on card', c.oliveInk, c.card],
    ['plumInk on card', c.plumInk, c.card],
    ['onTomato on tomatoStrong', c.onTomato, c.tomatoStrong],
    ['onSaffron on saffron', c.onSaffron, c.saffron],
    ['onOlive on olive', c.onOlive, c.olive],
    ['onPlum on plum', c.onPlum, c.plum],
    ['onHero on hero', c.onHero, c.hero],
    ['heroMute on hero', c.heroMute, c.hero],
    ['heroTomato on hero', c.heroTomato, c.hero],
    ['heroSaffron on hero', c.heroSaffron, c.hero],
    ['heroOlive on hero', c.heroOlive, c.hero],
    ['tomatoInk on tomatoSoft', c.tomatoInk, c.tomatoSoft],
    ['oliveInk on oliveSoft', c.oliveInk, c.oliveSoft],
    ['saffronInk on saffronSoft', c.saffronInk, c.saffronSoft],
  ]

  it.each(textPairs)('%s passes AA', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA)
  })

  it('has a visible focus ring against the background', () => {
    expect(contrastRatio(c.focus, c.paper)).toBeGreaterThanOrEqual(3)
  })
})

describe('avatar palette', () => {
  it.each(avatarPalette.map((p) => [p.bg, p.fg]))('%s with %s passes AA', (bg, fg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA)
  })

  it('is deterministic per seed', () => {
    expect(avatarColor('user-1')).toEqual(avatarColor('user-1'))
    const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => avatarColor(s).bg))
    expect(seen.size).toBeGreaterThan(2)
  })
})

describe('heatLevel', () => {
  it('maps zero to the coolest step and max to the hottest', () => {
    expect(heatLevel(0, 6)).toBe(0)
    expect(heatLevel(6, 6)).toBe(4)
    expect(heatLevel(9, 6)).toBe(4)
  })

  it('never shows someone as nobody', () => {
    expect(heatLevel(1, 100)).toBe(1)
  })

  it('handles an empty event', () => {
    expect(heatLevel(0, 0)).toBe(0)
    expect(heatLevel(3, 0)).toBe(0)
  })

  it('climbs monotonically', () => {
    const steps = [0, 1, 2, 3, 4, 5, 6].map((n) => heatLevel(n, 6))
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
  })
})

describe('toCssVariables', () => {
  it('emits prefixed color, heat and shape variables', () => {
    const vars = toCssVariables(lightTheme)
    expect(vars['--pl-paper']).toBe('#fbf5ea')
    expect(vars['--pl-tomato-strong']).toBe(lightTheme.colors.tomatoStrong)
    expect(vars['--pl-heat-4']).toBe('#e8492f')
    expect(vars['--pl-radius-card']).toBe('18px')
    expect(vars['--pl-radius-pill']).toBe('999px')
    expect(vars['--pl-space']).toBe('0.25rem')
    expect(vars['--pl-text-base']).toBe('1rem')
    expect(vars['--pl-font-display']).toContain('Instrument Serif')
  })

  it('emits the same keys for both themes', () => {
    expect(Object.keys(toCssVariables(darkTheme)).sort()).toEqual(
      Object.keys(toCssVariables(lightTheme)).sort(),
    )
  })

  it('limits the theme scope to values that change between themes', () => {
    const scoped = toCssVariables(darkTheme, { scope: 'theme' })
    expect(scoped['--pl-paper']).toBe('#14110e')
    expect(scoped['--pl-radius-card']).toBeUndefined()
  })

  it('serializes to a css rule', () => {
    expect(toCssRule(':root', { '--pl-a': '1px' })).toBe(':root {\n  --pl-a: 1px;\n}')
  })
})
