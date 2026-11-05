import { SegmentedControl, Switch, TooltipProvider } from '@potluck/ui'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTheme } from '@/styles/use-theme'
import { Gallery } from './gallery'
import { Phone } from './phone'
import { AvailabilityScreen } from './screen-availability'
import { GroupScreen } from './screen-group'
import { HomeScreen } from './screen-home'
import { TokensPanel } from './tokens-panel'

function Section({
  id,
  title,
  lede,
  children,
  aside,
}: {
  id: string
  title: string
  lede: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 id={id} className="font-display text-4xl leading-none sm:text-5xl">
            {title}
          </h2>
          <p className="mt-2 max-w-[60ch] text-[0.9375rem] text-mute">{lede}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Screens() {
  return (
    <div className="-mx-4 scrollbar-none flex snap-x snap-mandatory gap-8 overflow-x-auto px-4 pb-2 max-sm:gap-0 max-sm:px-0 xl:mx-0 xl:justify-center xl:px-0">
      <Phone label="Home" activeTab="home" className="snap-center">
        <HomeScreen />
      </Phone>
      <Phone label="Availability" className="snap-center">
        <AvailabilityScreen />
      </Phone>
      <Phone label="Group timeline" activeTab="groups" className="snap-center">
        <GroupScreen />
      </Phone>
    </div>
  )
}

export function KitPage() {
  const { preference, resolved, setPreference } = useTheme()
  const [compare, setCompare] = useState(false)
  const other = resolved === 'dark' ? 'light' : 'dark'

  return (
    <TooltipProvider>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[90rem] items-center justify-between gap-4 px-4 py-3 sm:px-8">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-2xl leading-none">Potluck</span>
              <span className="text-sm text-mute max-sm:hidden">design kit</span>
            </p>
            <SegmentedControl
              label="Theme"
              size="sm"
              value={preference}
              onValueChange={setPreference}
              options={[
                { value: 'light', label: 'Light', icon: <Sun /> },
                { value: 'dark', label: 'Dark', icon: <Moon /> },
                { value: 'system', label: 'Auto', icon: <Monitor /> },
              ]}
            />
          </div>
        </header>

        <main className="mx-auto flex max-w-[90rem] flex-col gap-20 px-4 pt-12 pb-24 sm:px-8">
          <div className="max-w-3xl">
            <h1 className="flourish text-6xl leading-[0.9] sm:text-7xl">Supper club.</h1>
            <p className="mt-4 max-w-[52ch] text-lg text-mute">
              Paper and ink, a splash of tomato and saffron. Every piece Potluck is built from, on
              one page, in both themes.
            </p>
          </div>

          <Section
            id="screens"
            title="Screens"
            lede="Static compositions of Home, an availability poll and a group timeline, built only from kit parts."
            aside={
              <Switch
                label={`Compare with ${other}`}
                checked={compare}
                onCheckedChange={setCompare}
              />
            }
          >
            <Screens />
            {compare && (
              <div
                data-theme={other}
                className="-mx-4 rounded-sheet bg-paper px-4 py-8 text-ink sm:mx-0"
              >
                <Screens />
              </div>
            )}
          </Section>

          <Section
            id="components"
            title="Components"
            lede="Everything in @potluck/ui. Try the keyboard: arrows move segmented controls and tabs, Escape closes sheets."
          >
            <Gallery />
          </Section>

          <Section
            id="tokens"
            title="Tokens"
            lede="From @potluck/tokens. Plain values, shared with the future native app."
          >
            <TokensPanel />
          </Section>
        </main>
      </div>
    </TooltipProvider>
  )
}
