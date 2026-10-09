import {
  Amount,
  Avatar,
  AvatarStack,
  Card,
  DateChip,
  IconButton,
  Stamp,
  StampAnimation,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@potluck/ui'
import { ArrowRightLeft, ChevronLeft, Settings } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { me, people, timeline } from './data'

const USD = 'USD'
const en = 'en-US'

function first(name: string) {
  return name.split(' ')[0]
}

function Entry({
  marker,
  children,
  last,
}: {
  marker: ReactNode
  children: ReactNode
  last?: boolean
}) {
  return (
    <li className="relative flex gap-3 pb-5">
      {!last && (
        <span
          aria-hidden
          className="absolute top-10 bottom-0 left-[1.1875rem] w-px bg-line-strong"
        />
      )}
      <span className="relative z-10 shrink-0">{marker}</span>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </li>
  )
}

function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid size-10 place-items-center rounded-[0.75rem] text-xl ${className ?? 'border border-line bg-card'}`}
    >
      {children}
    </span>
  )
}

type Item = (typeof timeline)[number]['items'][number]

function TimelineItem({ item, last }: { item: Item; last: boolean }) {
  switch (item.kind) {
    case 'expense':
      return (
        <Entry last={last} marker={<Tile>{item.emoji}</Tile>}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold">{item.what}</p>
              <p className="text-sm text-mute">
                {item.who.id === me.id ? 'You' : first(item.who.name)} paid{' '}
                <Amount cents={item.cents} currency={USD} locale={en} tone="inherit" />
              </p>
            </div>
            <div className="text-right">
              <p className="text-[0.9375rem] font-bold">
                <Amount cents={item.yourShare} currency={USD} locale={en} />
              </p>
              <p className="text-xs text-mute">{item.yourShare < 0 ? 'you owe' : 'you lent'}</p>
            </div>
          </div>
        </Entry>
      )
    case 'settlement':
      return (
        <Entry
          last={last}
          marker={
            <Tile className="bg-olive-soft text-olive-ink">
              <ArrowRightLeft className="size-5" />
            </Tile>
          }
        >
          <p className="text-[0.9375rem]">
            <span className="font-semibold">{first(item.who.name)}</span> paid you{' '}
            <span className="font-bold">
              <Amount cents={item.cents} currency={USD} locale={en} tone="settled" />
            </span>
          </p>
          <p className="tabular text-sm text-mute">{item.time}</p>
        </Entry>
      )
    case 'event':
      return <LockedEvent item={item} last={last} />
    case 'joined':
      return (
        <Entry last={last} marker={<Avatar name={item.who.name} seed={item.who.id} size="md" />}>
          <p className="text-[0.9375rem]">
            <span className="font-semibold">{first(item.who.name)}</span> joined the group
          </p>
          <p className="tabular text-sm text-mute">{item.time}</p>
        </Entry>
      )
  }
}

function LockedEvent({ item, last }: { item: Extract<Item, { kind: 'event' }>; last: boolean }) {
  const [stamped, setStamped] = useState(true)
  return (
    <Entry last={last} marker={<DateChip date={item.when} locale={en} size="sm" tone="tomato" />}>
      <Card
        className="relative -mt-0.5 overflow-hidden [--avatar-ring:var(--pl-card)]"
        onClick={() => {
          setStamped(false)
          window.setTimeout(() => setStamped(true), 250)
        }}
      >
        <p className="text-sm text-mute">{first(item.who.name)} locked in a plan</p>
        <p className="mt-1 flourish text-2xl leading-tight">
          {item.emoji} {item.what}
        </p>
        <p className="mt-1 tabular text-sm font-semibold">Sun, Nov 22, 10:00 am</p>
        <div className="mt-3">
          <AvatarStack
            people={people.slice(1, 5).map((p) => ({ ...p }))}
            size="xs"
            label="4 going"
          />
        </div>
        <div className="absolute top-4 right-3">
          <StampAnimation show={stamped} rotate={-8}>
            <Stamp caption="Nov 22">Locked in</Stamp>
          </StampAnimation>
        </div>
      </Card>
    </Entry>
  )
}

export function GroupScreen() {
  const [tab, setTab] = useState('activity')
  return (
    <div className="flex flex-col gap-5 px-4">
      <div className="-mx-2 flex items-center justify-between">
        <IconButton label="Back" icon={<ChevronLeft />} />
        <IconButton label="Group settings" icon={<Settings />} />
      </div>
      <header className="-mt-2 flex items-end gap-4">
        <span
          aria-hidden
          className="grid size-[4.5rem] shrink-0 rotate-[-4deg] place-items-center rounded-[1.25rem] bg-olive-soft text-[2.5rem]"
        >
          🏕️
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-[2.5rem] leading-[0.95]">Cabin crew</h1>
          <div className="mt-2 flex items-center gap-2">
            <AvatarStack people={[...people].slice(0, 6)} max={4} size="xs" label="6 members" />
            <span className="text-sm text-mute">6 people</span>
          </div>
        </div>
      </header>

      <Card tone="sunken" padding="tight" className="flex items-center justify-between px-4">
        <span className="text-sm font-semibold">You’re owed</span>
        <span className="text-2xl font-extrabold">
          <Amount cents={11240} currency={USD} locale={en} />
        </span>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Group sections">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="plans" count={2}>
            Plans
          </TabsTrigger>
        </TabsList>
        <TabsContent value="activity">
          {timeline.map((section, si) => (
            <section key={section.label} aria-label={section.label}>
              <h2 className="mb-3 text-xs font-bold text-mute">{section.label}</h2>
              <ol>
                {section.items.map((item, i) => (
                  <TimelineItem
                    key={item.id}
                    item={item}
                    last={si === timeline.length - 1 && i === section.items.length - 1}
                  />
                ))}
              </ol>
            </section>
          ))}
        </TabsContent>
        <TabsContent value="balances">
          <p className="text-sm text-mute">Balances go here.</p>
        </TabsContent>
        <TabsContent value="plans">
          <p className="text-sm text-mute">Plans go here.</p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
