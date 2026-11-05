import { breakpoints, radii, SPACE_UNIT, zIndex } from './layout'
import { durations, easings } from './motion'
import type { Theme } from './theme'
import { fontFamily, typeScale } from './typography'

/** Every generated custom property starts with this prefix. */
export const CSS_VAR_PREFIX = '--pl-'

export type CssVariables = Record<`--${string}`, string>

export interface ToCssVariablesOptions {
  /**
   * `all` (default) emits every token. `theme` emits only the values that
   * change between light and dark, for an override block.
   */
  scope?: 'all' | 'theme'
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function v(name: string): `--${string}` {
  return `${CSS_VAR_PREFIX}${name}` as `--${string}`
}

/**
 * Turns a theme into a flat map of CSS custom properties. Pure: no DOM, so the
 * web app can inject or render it and a native app can ignore it.
 *
 * Naming: colors are `--pl-<kebab-key>` (`--pl-tomato-strong`), heat steps
 * `--pl-heat-0..4`, then `--pl-shadow-*`, `--pl-radius-*`, `--pl-font-*`,
 * `--pl-text-*`, `--pl-z-*`, `--pl-duration-*`, `--pl-ease-*`.
 */
export function toCssVariables(theme: Theme, options: ToCssVariablesOptions = {}): CssVariables {
  const out: CssVariables = {}

  for (const [key, value] of Object.entries(theme.colors)) out[v(kebab(key))] = value
  theme.heat.forEach((value, i) => {
    out[v(`heat-${i}`)] = value
  })
  for (const [key, value] of Object.entries(theme.shadows)) out[v(`shadow-${key}`)] = value
  out[v('color-scheme')] = theme.name

  if (options.scope === 'theme') return out

  for (const [key, value] of Object.entries(radii)) out[v(`radius-${key}`)] = `${value}px`
  out[v('space')] = `${SPACE_UNIT / 16}rem`
  for (const [key, value] of Object.entries(fontFamily)) out[v(`font-${key}`)] = value
  for (const [key, step] of Object.entries(typeScale)) {
    out[v(`text-${key}`)] = `${step.size}rem`
    out[v(`text-${key}-leading`)] = String(step.lineHeight)
    out[v(`text-${key}-tracking`)] = `${step.tracking}em`
  }
  for (const [key, value] of Object.entries(zIndex)) out[v(`z-${key}`)] = String(value)
  for (const [key, value] of Object.entries(durations)) out[v(`duration-${key}`)] = `${value}ms`
  for (const [key, value] of Object.entries(easings)) {
    out[v(`ease-${kebab(key)}`)] = `cubic-bezier(${value.join(', ')})`
  }
  for (const [key, value] of Object.entries(breakpoints)) out[v(`breakpoint-${key}`)] = `${value}px`

  return out
}

/** Serializes a variable map into a CSS rule, e.g. for a `<style>` tag. */
export function toCssRule(selector: string, variables: CssVariables): string {
  const body = Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')
  return `${selector} {\n${body}\n}`
}
