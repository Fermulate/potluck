/**
 * Group colors. `groups.color` stores a short name; older rows (and the seed) use plain color
 * words, which map onto the same palette.
 */
export const GROUP_COLORS = ['tomato', 'saffron', 'olive', 'plum', 'sea', 'ink'] as const
export type GroupColor = (typeof GROUP_COLORS)[number]

const ALIASES: Record<string, GroupColor> = {
  red: 'tomato',
  orange: 'saffron',
  yellow: 'saffron',
  green: 'olive',
  purple: 'plum',
  blue: 'sea',
  teal: 'sea',
  black: 'ink',
}

export function normalizeGroupColor(color: string | null | undefined): GroupColor {
  if (!color) return 'saffron'
  if ((GROUP_COLORS as readonly string[]).includes(color)) return color as GroupColor
  return ALIASES[color] ?? 'saffron'
}

interface Tone {
  /** Tinted tile behind the emoji. */
  soft: string
  /** Solid swatch. */
  solid: string
  /** Text that sits on the soft tint. */
  ink: string
}

const TONES: Record<GroupColor, Tone> = {
  tomato: { soft: 'bg-tomato-soft', solid: 'bg-tomato', ink: 'text-tomato-ink' },
  saffron: { soft: 'bg-saffron-soft', solid: 'bg-saffron', ink: 'text-saffron-ink' },
  olive: { soft: 'bg-olive-soft', solid: 'bg-olive', ink: 'text-olive-ink' },
  plum: { soft: 'bg-plum-soft', solid: 'bg-plum', ink: 'text-plum-ink' },
  sea: {
    soft: 'bg-[color-mix(in_oklab,#2f5d6b_18%,var(--pl-card))]',
    solid: 'bg-[#2f5d6b]',
    ink: 'text-ink',
  },
  ink: { soft: 'bg-sunken', solid: 'bg-ink', ink: 'text-ink' },
}

export function groupTone(color: string | null | undefined): Tone {
  return TONES[normalizeGroupColor(color)]
}

export const DEFAULT_GROUP_EMOJI = '🍲'
