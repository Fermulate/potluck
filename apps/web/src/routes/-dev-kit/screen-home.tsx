import {
  Amount,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  DateChip,
  IconButton,
  ListRow,
  ProgressRing,
} from '@potluck/ui'
import { Bell, MapPin } from 'lucide-react'
import { balances, me, needsYou, person, upcoming } from './data'

const USD = 'USD'
const en = 'en-US'

function time(d: Date) {
  return new Intl.DateTimeFormat(en, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

// Perforated bottom edge, like a bill torn off the pad.
const TEAR =
  'radial-gradient(circle 6px at 50% 100%, #0000 5.5px, #000 6px) 50% 100% / 16px 100% repeat-x'

/** The balance hero: the bill, torn off the pad. */
export function BalanceHero() {
  return (
    <section
      aria-label="Your balance"
      className="relative overflow-hidden rounded-t-[1.375rem] on-hero px-5 pt-5 pb-8"
      style={{ mask: TEAR, WebkitMask: TEAR }}
    >
      <div className="flex items-center justify-between text-sm text-hero-mute">
        <span>Across 4 groups</span>
        <span className="tabular">Nov 12</span>
      </div>
      <p className="mt-5 flourish text-2xl leading-none text-hero-mute">All told, you’re owed</p>
      <div className="mt-1 text-[4.5rem] leading-[0.95] font-extrabold tracking-[-0.045em]">
        <Amount
          cents={balances.net}
          currency={USD}
          locale={en}
          surface="hero"
          split
          countUp
          srLabel="You are owed $248.50 overall"
        />
      </div>
      <div aria-hidden className="my-5 border-t border-dashed border-current opacity-25" />
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-hero-mute">You owe</dt>
          <dd className="mt-0.5 text-lg font-bold">
            <Amount
              cents={-balances.owe}
              currency={USD}
              locale={en}
              surface="hero"
              sign="never"
              tone="owe"
            />
          </dd>
        </div>
        <div>
          <dt className="text-hero-mute">Owed to you</dt>
          <dd className="mt-0.5 text-lg font-bold">
            <Amount cents={balances.owed} currency={USD} locale={en} surface="hero" tone="owed" />
          </dd>
        </div>
      </dl>
      <div className="mt-5 flex gap-2">
        <Button
          size="sm"
          className="flex-1 bg-on-hero text-hero hover:brightness-100"
          variant="ink"
        >
          Settle up
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 border border-current/25 text-on-hero hover:bg-on-hero/10"
        >
          See who
        </Button>
      </div>
    </section>
  )
}

function NeedsYouCard({ item }: { item: (typeof needsYou)[number] }) {
  return (
    <Card className="flex w-64 shrink-0 snap-start flex-col gap-3 [--avatar-ring:var(--color-card)]">
      <div className="flex items-center gap-2 text-xs font-semibold text-mute">
        <span aria-hidden className="text-base leading-none">
          {item.emoji}
        </span>
        {item.group}
      </div>
      <p className="text-[1.0625rem] leading-snug font-semibold text-balance">{item.title}</p>
      <div className="mt-auto flex items-center justify-between gap-2">
        {item.kind === 'availability' && (
          <>
            <ProgressRing
              value={item.replied / item.total}
              label="Replies"
              valueText={`${item.replied} of ${item.total} replied`}
              size={40}
              thickness={4}
            >
              {item.replied}/{item.total}
            </ProgressRing>
            <Button size="sm">Add your times</Button>
          </>
        )}
        {item.kind === 'settle' && (
          <>
            <span className="text-xl font-extrabold">
              <Amount cents={item.cents} currency={USD} locale={en} />
            </span>
            <Button size="sm" variant="ink">
              Pay Priya
            </Button>
          </>
        )}
        {item.kind === 'rsvp' && (
          <>
            <Avatar name={item.from.name} seed={item.from.id} size="sm" />
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary">
                Can’t
              </Button>
              <Button size="sm">Going</Button>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

export function HomeScreen() {
  return (
    <div className="flex flex-col gap-7 px-4 pt-2">
      <header className="flex items-center justify-between">
        <div>
          <p className="flourish text-[1.75rem] leading-none text-ink">Evening, Maya.</p>
          <p className="mt-1.5 text-sm text-mute">Three things need you this week.</p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Notifications" icon={<Bell />} />
          <Avatar name={me.name} seed={me.id} size="md" />
        </div>
      </header>

      <BalanceHero />

      <section aria-labelledby="needs-you" className="-mx-4 flex flex-col gap-3">
        <div className="flex items-baseline justify-between px-4">
          <h2 id="needs-you" className="text-xl font-bold tracking-tight">
            Needs you
          </h2>
          <Badge tone="tomato">3 waiting</Badge>
        </div>
        <div className="scrollbar-none flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
          {needsYou.map((item) => (
            <NeedsYouCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      <section aria-labelledby="coming-up" className="flex flex-col gap-3">
        <h2 id="coming-up" className="text-xl font-bold tracking-tight">
          Coming up
        </h2>
        <Card
          padding="none"
          className="divide-y divide-line overflow-hidden [--avatar-ring:var(--color-card)]"
        >
          {upcoming.map((e) => (
            <ListRow
              key={e.id}
              asChild
              leading={
                <DateChip
                  date={e.when}
                  locale={en}
                  tone={e.status === 'polling' ? 'ink' : 'saffron'}
                />
              }
              title={e.title}
              subtitle={
                <span className="inline-flex items-center gap-1">
                  {e.status === 'polling' ? (
                    'Still picking a time'
                  ) : (
                    <>
                      <span className="tabular">{time(e.when)}</span>
                      <span aria-hidden>,</span>
                      <MapPin aria-hidden className="ml-0.5 size-3.5" />
                      {e.where}
                    </>
                  )}
                </span>
              }
              meta={
                <AvatarStack
                  size="xs"
                  max={3}
                  people={e.going.map((id) => person(id))}
                  label={`${e.going.length} going`}
                />
              }
              metaSub={e.group}
            >
              <a href="#" />
            </ListRow>
          ))}
        </Card>
      </section>
    </div>
  )
}
