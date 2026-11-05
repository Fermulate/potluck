import { themes, typeScale, type ThemeColors, type ThemeName } from '@potluck/tokens'

const swatches: Array<{ key: keyof ThemeColors; label: string; note: string }> = [
  { key: 'paper', label: 'Paper', note: 'Background' },
  { key: 'card', label: 'Card', note: 'Surfaces' },
  { key: 'ink', label: 'Ink', note: 'Text, hero' },
  { key: 'mute', label: 'Mute', note: 'Secondary text' },
  { key: 'line', label: 'Line', note: 'Borders' },
  { key: 'tomato', label: 'Tomato', note: 'Action, you owe' },
  { key: 'saffron', label: 'Saffron', note: 'Owed to you' },
  { key: 'olive', label: 'Olive', note: 'Settled' },
  { key: 'plum', label: 'Plum', note: 'Accents' },
]

function Palette({ name }: { name: ThemeName }) {
  const t = themes[name]
  return (
    <div
      data-theme={name}
      className="flex flex-col gap-4 rounded-card border border-line bg-paper p-5 text-ink"
    >
      <p className="text-sm font-bold">{name === 'light' ? 'Light' : 'Dark'}</p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
        {swatches.map((s) => (
          <div key={s.key} className="flex flex-col gap-1.5">
            <span
              className="h-14 rounded-[0.75rem] border border-line"
              style={{ backgroundColor: t.colors[s.key] }}
            />
            <span className="text-xs leading-tight font-semibold">{s.label}</span>
            <span className="tabular text-[0.6875rem] leading-tight text-mute">
              {t.colors[s.key]}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {t.heat.map((c) => (
          <span key={c} className="h-6 flex-1 rounded-[5px]" style={{ backgroundColor: c }} />
        ))}
      </div>
    </div>
  )
}

export function TokensPanel() {
  const steps = Object.entries(typeScale).reverse()
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        <Palette name="light" />
        <Palette name="dark" />
      </div>
      <div className="flex flex-col gap-1 overflow-hidden rounded-card border border-line bg-card p-5">
        <p className="mb-2 text-sm font-bold">Type</p>
        {steps.slice(0, 4).map(([name, step]) => (
          <div key={name} className="flex items-baseline gap-4">
            <span className="w-10 shrink-0 tabular text-xs text-mute">{step.size * 16}</span>
            <span
              className="truncate font-display"
              style={{ fontSize: `${step.size}rem`, lineHeight: step.lineHeight }}
            >
              {name === '7xl'
                ? 'Supper club'
                : name === '6xl'
                  ? 'Lake day'
                  : name === '5xl'
                    ? 'Ramen night'
                    : 'Friendsgiving'}
            </span>
          </div>
        ))}
        {steps.slice(4).map(([name, step]) => (
          <div key={name} className="flex items-baseline gap-4">
            <span className="w-10 shrink-0 tabular text-xs text-mute">{step.size * 16}</span>
            <span
              className="truncate font-semibold"
              style={{ fontSize: `${step.size}rem`, lineHeight: step.lineHeight }}
            >
              {name === '3xl' || name === '2xl' ? (
                <span className="tabular font-extrabold">$1,284.50</span>
              ) : (
                'Who paid for the groceries?'
              )}
            </span>
          </div>
        ))}
        <p className="mt-4 flourish text-2xl">Instrument Serif, italic for flourishes.</p>
        <p className="text-sm text-mute">
          Bricolage Grotesque for everything else, 400 to 800, tabular figures on every amount.
        </p>
      </div>
    </div>
  )
}
