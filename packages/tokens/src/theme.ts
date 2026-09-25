import { darkColors, heat, lightColors, type ThemeColors } from './color'
import { shadows } from './layout'

export type ThemeName = 'light' | 'dark'

export interface Theme {
  name: ThemeName
  colors: ThemeColors
  heat: readonly string[]
  shadows: { raised: string; sheet: string; pop: string }
}

export const lightTheme: Theme = {
  name: 'light',
  colors: lightColors,
  heat: heat.light,
  shadows: shadows.light,
}

export const darkTheme: Theme = {
  name: 'dark',
  colors: darkColors,
  heat: heat.dark,
  shadows: shadows.dark,
}

export const themes: Record<ThemeName, Theme> = {
  light: lightTheme,
  dark: darkTheme,
}
