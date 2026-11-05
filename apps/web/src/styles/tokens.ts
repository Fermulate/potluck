import { darkTheme, lightTheme, toCssRule, toCssVariables } from '@potluck/tokens'

const STYLE_ID = 'pl-tokens'

/**
 * The full token stylesheet: light on :root, dark when `data-theme="dark"`
 * is set on any element (so a subtree can preview the other theme), and dark
 * from the OS preference when no explicit theme is set.
 */
export function tokensStylesheet(): string {
  const light = toCssVariables(lightTheme)
  const lightScoped = toCssVariables(lightTheme, { scope: 'theme' })
  const dark = toCssVariables(darkTheme, { scope: 'theme' })
  return [
    toCssRule(':root', light),
    toCssRule("[data-theme='light']", lightScoped),
    toCssRule("[data-theme='dark']", dark),
    `@media (prefers-color-scheme: dark) {\n${toCssRule(":root:not([data-theme='light'])", dark)}\n}`,
  ].join('\n\n')
}

/** Injects (or refreshes) the token stylesheet. Call once before rendering. */
export function installTokens(doc: Document = document): void {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = STYLE_ID
    doc.head.prepend(style)
  }
  style.textContent = tokensStylesheet()
}
