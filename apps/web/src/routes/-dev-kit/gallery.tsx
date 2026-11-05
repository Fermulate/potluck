import {
  AddButton,
  Amount,
  Avatar,
  AvatarStack,
  Badge,
  BottomTabBar,
  Button,
  Card,
  Checkbox,
  Chip,
  Confetti,
  ConfirmDialog,
  DateChip,
  EmptyState,
  Field,
  HeatCell,
  IconButton,
  Input,
  ListRow,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  MoneyInput,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressRing,
  SegmentedControl,
  Select,
  Sheet,
  SheetContent,
  SheetTrigger,
  SideRail,
  Skeleton,
  Spinner,
  Stamp,
  StampAnimation,
  Switch,
  TextArea,
  toast,
  Tooltip,
  type HeatLevel,
} from '@potluck/ui'
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  Ellipsis,
  HandCoins,
  Pencil,
  Plus,
  Receipt,
  Search,
  Share,
  Trash,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { day, me, people } from './data'
import { tabs } from './phone'

const en = 'en-US'

function Block({
  title,
  note,
  children,
  className,
}: {
  title: string
  note?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      aria-labelledby={`kit-${title}`}
      className={`flex flex-col gap-4 rounded-card border border-line bg-card p-5 sm:p-6 ${className ?? ''}`}
    >
      <header>
        <h3 id={`kit-${title}`} className="text-lg font-bold tracking-tight">
          {title}
        </h3>
        {note && <p className="mt-0.5 text-sm text-mute">{note}</p>}
      </header>
      {children}
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

function Buttons() {
  const [loading, setLoading] = useState(false)
  return (
    <Block title="Buttons" note="Pills. Tomato for the one main action on a screen.">
      <Row>
        <Button>Add expense</Button>
        <Button variant="secondary">Invite</Button>
        <Button variant="ghost">Skip</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="ink">Settle up</Button>
      </Row>
      <Row>
        <Button size="sm" leadingIcon={<Plus />}>
          Small
        </Button>
        <Button size="md" trailingIcon={<ArrowUpRight />} variant="secondary">
          Medium
        </Button>
        <Button size="lg">Large</Button>
        <Button
          loading={loading}
          onClick={() => {
            setLoading(true)
            window.setTimeout(() => setLoading(false), 1600)
          }}
        >
          Save
        </Button>
        <Button disabled>Disabled</Button>
      </Row>
      <Row>
        <IconButton label="Search" icon={<Search />} />
        <IconButton label="Share" icon={<Share />} variant="secondary" />
        <IconButton label="Edit" icon={<Pencil />} variant="ink" size="sm" />
        <IconButton label="Delete" icon={<Trash />} variant="danger" size="sm" />
        <AddButton label="Add" size="md" />
      </Row>
    </Block>
  )
}

function Inputs() {
  const [cents, setCents] = useState<number | null>(4250)
  const [currency, setCurrency] = useState('USD')
  return (
    <Block title="Inputs" note="Labels above, errors in tomato, money in big tabular digits.">
      <Card tone="sunken" className="py-8">
        <MoneyInput
          label="Amount"
          value={cents}
          onValueChange={setCents}
          currency={currency}
          locale={en}
          onCurrencyPress={() =>
            setCurrency((c) => (c === 'USD' ? 'EUR' : c === 'EUR' ? 'JPY' : 'USD'))
          }
          currencyButtonLabel={`Change currency, ${currency}`}
        />
        <div className="mt-4 flex justify-center gap-2">
          {[1000, 2500, 5000].map((v) => (
            <Chip key={v} selected={cents === v} onClick={() => setCents(v)}>
              <Amount cents={v} currency={currency} locale={en} tone="inherit" />
            </Chip>
          ))}
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What was it for?" hint="Shows up in everyone's activity.">
          <Input placeholder="Dinner at Ippudo" leading={<Receipt />} />
        </Field>
        <Field label="Paid by">
          <Select
            defaultValue="u-maya"
            options={people.slice(0, 5).map((p) => ({
              value: p.id,
              label: p.id === me.id ? 'You' : p.name,
              icon: <Avatar name={p.name} seed={p.id} size="xs" />,
              textValue: p.name,
            }))}
          />
        </Field>
        <Field label="Group name" error="Give the group a name.">
          <Input defaultValue="" placeholder="Cabin crew" />
        </Field>
        <Field label="Notes">
          <TextArea placeholder="Tip included" />
        </Field>
      </div>
    </Block>
  )
}

function Choices() {
  const [split, setSplit] = useState<'equal' | 'exact' | 'percent' | 'shares'>('equal')
  const [chips, setChips] = useState<string[]>(['food'])
  const toggle = (c: string) =>
    setChips((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  return (
    <Block title="Choices" note="Segmented control for modes, chips for filters.">
      <SegmentedControl
        label="Split"
        value={split}
        onValueChange={setSplit}
        options={[
          { value: 'equal', label: 'Equally' },
          { value: 'exact', label: 'Exact' },
          { value: 'percent', label: '%' },
          { value: 'shares', label: 'Shares' },
        ]}
      />
      <Row>
        {[
          ['food', '🍝 Food'],
          ['travel', '🚗 Travel'],
          ['home', '🏠 Home'],
          ['fun', '🎟️ Fun'],
        ].map(([id, label]) => (
          <Chip key={id} selected={chips.includes(id!)} onClick={() => toggle(id!)}>
            {label}
          </Chip>
        ))}
      </Row>
      <div className="grid gap-4 sm:grid-cols-2">
        <Switch label="Simplify debts" description="Fewer payments, same totals." defaultChecked />
        <Switch label="Members can invite" />
        <Checkbox label="Include me" defaultChecked />
        <Checkbox label="Remind everyone" description="One nudge, the day before." />
      </div>
    </Block>
  )
}

function People() {
  return (
    <Block title="People" note="Initials fall back to a color picked from the person's id.">
      <Row>
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s, i) => (
          <Avatar key={s} name={people[i]!.name} seed={people[i]!.id} size={s} />
        ))}
      </Row>
      <Row>
        <AvatarStack people={[...people]} size="md" max={4} label="7 people" />
        <AvatarStack people={[...people].slice(0, 3)} size="sm" />
      </Row>
      <Row>
        <Badge>Draft</Badge>
        <Badge tone="tomato" dot>
          You owe
        </Badge>
        <Badge tone="saffron" dot>
          Polling
        </Badge>
        <Badge tone="olive" dot>
          Settled
        </Badge>
        <Badge tone="plum">Admin</Badge>
        <Badge tone="ink">Owner</Badge>
      </Row>
    </Block>
  )
}

function Money() {
  const [n, setN] = useState(12840)
  return (
    <Block
      title="Amounts"
      note="Tabular figures. Colored by sign: tomato you owe, saffron owed to you."
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-2xl font-extrabold">
        <Amount cents={-4210} currency="USD" locale={en} />
        <Amount cents={8800} currency="USD" locale={en} />
        <Amount cents={0} currency="USD" locale={en} />
        <Amount cents={5000} currency="USD" locale={en} tone="settled" />
        <Amount cents={150000} currency="JPY" locale="ja-JP" />
        <Amount cents={2350} currency="EUR" locale="de-DE" sign="always" />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-6xl font-extrabold tracking-[-0.04em]">
          <Amount cents={n} currency="USD" locale={en} split countUp />
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setN(Math.round(Math.random() * 90000))}
        >
          Count up
        </Button>
      </div>
    </Block>
  )
}

function Dates() {
  return (
    <Block title="Dates" note="Tear-off leaves: saffron upcoming, tomato soon, ink still polling.">
      <Row>
        <DateChip date={day(1)} locale={en} size="sm" tone="tomato" />
        <DateChip date={day(3)} locale={en} />
        <DateChip date={day(9)} locale={en} showWeekday />
        <DateChip date={day(21)} locale={en} size="lg" tone="ink" showWeekday />
      </Row>
    </Block>
  )
}

function Feedback() {
  const [show, setShow] = useState(false)
  return (
    <Block title="Loading and progress" note="Skeletons first. Spinners wait 300ms before showing.">
      <div aria-busy aria-label="Loading activity" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Skeleton shape="circle" className="size-10" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton shape="line" className="w-2/3" />
            <Skeleton shape="line" className="w-1/3" />
          </div>
          <Skeleton shape="line" className="w-14" />
        </div>
        <Skeleton className="h-20" />
      </div>
      <Row>
        <ProgressRing value={0.25} label="Replies" tone="plum">
          1/4
        </ProgressRing>
        <ProgressRing value={0.66} label="Replies" tone="saffron" size={56}>
          4/6
        </ProgressRing>
        <ProgressRing value={1} label="Settled" tone="olive" size={64} thickness={6}>
          All
        </ProgressRing>
        <Button variant="secondary" size="sm" onClick={() => setShow((s) => !s)}>
          {show ? 'Hide spinner' : 'Show spinner'}
        </Button>
        {show && <Spinner label="Loading" className="text-tomato" />}
      </Row>
      <Row>
        <Button variant="secondary" size="sm" onClick={() => toast.success('Expense added')}>
          Success toast
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            toast('Expense deleted', { action: { label: 'Undo', onClick: () => undefined } })
          }
        >
          Toast with undo
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => toast.error('Could not reach the server')}
        >
          Error toast
        </Button>
      </Row>
    </Block>
  )
}

function Moments() {
  const [fire, setFire] = useState(0)
  const [stamp, setStamp] = useState(true)
  return (
    <Block
      title="Moments"
      note="Settle-up confetti and the lock-in stamp. Both fade under reduced motion."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card tone="sunken" className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="text-5xl font-extrabold">
            <Amount cents={fire > 0 ? 0 : -4210} currency="USD" locale={en} countUp />
          </span>
          <p className="text-sm text-mute">{fire > 0 ? 'All square with Theo.' : 'You owe Theo'}</p>
          <Button
            variant={fire > 0 ? 'secondary' : 'primary'}
            leadingIcon={<HandCoins />}
            onClick={() => setFire((f) => (f > 0 ? 0 : f + 1))}
          >
            {fire > 0 ? 'Reset' : 'Settle up'}
          </Button>
          <Confetti fire={fire} />
        </Card>
        <Card tone="sunken" className="flex flex-col items-center justify-center gap-4 py-6">
          <div className="grid h-20 place-items-center">
            <StampAnimation show={stamp}>
              <Stamp caption="Sun, Nov 22">Locked in</Stamp>
            </StampAnimation>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStamp(false)
              window.setTimeout(() => setStamp(true), 300)
            }}
          >
            Stamp again
          </Button>
          <Row>
            <Stamp tone="olive">Settled</Stamp>
            <Stamp tone="plum" caption="RSVP">
              Going
            </Stamp>
          </Row>
        </Card>
      </div>
    </Block>
  )
}

function Overlays() {
  const [confirm, setConfirm] = useState(false)
  return (
    <Block
      title="Sheets and menus"
      note="Bottom sheet on phones (drag down to dismiss), centered dialog on wider screens."
    >
      <Row>
        <Sheet>
          <SheetTrigger asChild>
            <Button leadingIcon={<Plus />}>Quick add</Button>
          </SheetTrigger>
          <SheetContent title="What are we adding?" closeLabel="Close">
            <div className="grid gap-2 pt-1">
              {[
                ['🧾', 'Add expense', 'Split a bill with a group or a friend'],
                ['🗓️', 'Plan something', 'Find a time that works for everyone'],
                ['🤝', 'Settle up', 'Record a payment'],
              ].map(([emoji, title, sub]) => (
                <ListRow
                  key={title}
                  asChild
                  className="rounded-card border border-line"
                  leading={
                    <span
                      aria-hidden
                      className="grid size-11 place-items-center rounded-[0.75rem] bg-sunken text-2xl"
                    >
                      {emoji}
                    </span>
                  }
                  title={title}
                  subtitle={sub}
                  chevron
                >
                  <button type="button" />
                </ListRow>
              ))}
            </div>
          </SheetContent>
        </Sheet>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">New expense</Button>
          </SheetTrigger>
          <SheetContent
            title="New expense"
            description="Cabin crew"
            closeLabel="Close"
            footer={
              <Button block size="lg">
                Add expense
              </Button>
            }
          >
            <div className="flex min-w-0 flex-col gap-5">
              <div className="py-4">
                <MoneyInput
                  label="Amount"
                  value={9240}
                  onValueChange={() => undefined}
                  currency="USD"
                  locale={en}
                />
              </div>
              <Field label="What was it for?">
                <Input placeholder="Gas, both cars" />
              </Field>
              <Field label="Split">
                <SegmentedControl
                  label="Split"
                  block
                  value="equal"
                  onValueChange={() => undefined}
                  options={[
                    { value: 'equal', label: 'Equally' },
                    { value: 'exact', label: 'Exact' },
                    { value: 'shares', label: 'Shares' },
                  ]}
                />
              </Field>
            </div>
          </SheetContent>
        </Sheet>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Delete expense
        </Button>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Delete this expense?"
          description="Gas, both cars, $92.40. Everyone's balances update right away."
          confirmLabel="Delete"
          cancelLabel="Keep it"
          closeLabel="Close"
          tone="danger"
          onConfirm={() => new Promise((r) => window.setTimeout(r, 900))}
        />
      </Row>
      <Row>
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Expense options" icon={<Ellipsis />} variant="secondary" />
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Pencil />}>Edit</MenuItem>
            <MenuItem icon={<Share />}>Share</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash />} tone="danger">
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm">
              Who’s in?
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="text-sm font-semibold">5 going</p>
            <AvatarStack className="mt-2" people={[...people].slice(0, 5)} max={5} size="sm" />
          </PopoverContent>
        </Popover>
        <Tooltip content="Copy invite link">
          <IconButton label="Copy invite link" icon={<Share />} />
        </Tooltip>
      </Row>
    </Block>
  )
}

function Lists() {
  return (
    <Block title="Headers and rows">
      <PageHeader
        flourish="Thursday, November 12"
        title="Plans"
        subtitle="Two things to reply to."
        actions={<IconButton label="Search" icon={<Search />} variant="secondary" />}
      />
      <PageHeader
        size="compact"
        leading={<IconButton label="Back" icon={<ChevronLeft />} />}
        actions={<IconButton label="More" icon={<Ellipsis />} />}
        title="Lake day"
      />
      <Card padding="none" className="divide-y divide-line overflow-hidden">
        <ListRow
          asChild
          leading={<Avatar name="Priya Raman" seed="u-priya" />}
          title="Priya Raman"
          subtitle="Cabin crew"
          meta={<Amount cents={-3620} currency="USD" locale={en} />}
          metaSub="you owe"
          chevron
        >
          <a href="#" />
        </ListRow>
        <ListRow
          asChild
          leading={<Avatar name="Theo Lindqvist" seed="u-theo" />}
          title="Theo Lindqvist"
          subtitle="3 groups"
          meta={<Amount cents={5000} currency="USD" locale={en} />}
          metaSub="owes you"
          chevron
        >
          <a href="#" />
        </ListRow>
        <ListRow
          leading={<Avatar name="Jun Park" seed="u-jun" />}
          title="Jun Park"
          subtitle="Thursday regulars"
          meta={<Amount cents={0} currency="USD" locale={en} tone="settled" />}
          metaSub="all square"
        />
      </Card>
    </Block>
  )
}

function Empty() {
  return (
    <Block title="Empty states">
      <Card tone="ghost" padding="none">
        <EmptyState
          illustration="🥂"
          title="Nobody owes anybody."
          description="Add an expense when someone picks up the tab."
          action={<Button leadingIcon={<Plus />}>Add expense</Button>}
        />
      </Card>
    </Block>
  )
}

function Heat() {
  const max = 7
  return (
    <Block
      title="Heat"
      note="Five steps from nobody to everyone. Hatched means busy on their calendar."
    >
      <div className="grid grid-cols-8 gap-1">
        {Array.from({ length: max + 1 }, (_, n) => {
          const level = Math.min(4, n === 0 ? 0 : Math.ceil((n / max) * 4)) as HeatLevel
          return (
            <div key={n} className="flex flex-col items-center gap-1">
              <HeatCell level={level} className="h-10" aria-label={`${n} of ${max} free`} />
              <span className="tabular text-xs text-mute">{n}</span>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-4 gap-1">
        <HeatCell level={2} className="h-10" mine="yes" aria-label="You are free" />
        <HeatCell level={2} className="h-10" mine="maybe" aria-label="You might be free" />
        <HeatCell level={3} className="h-10" busy aria-label="Busy" />
        <HeatCell level={4} className="h-10" selected aria-label="Best time" />
      </div>
    </Block>
  )
}

function Navigation() {
  return (
    <Block title="Navigation" note="Tab bar on phones, rail from lg up. Route wiring comes later.">
      <div className="overflow-hidden rounded-card border border-line bg-paper">
        <div className="grid min-h-60 grid-cols-[15.5rem_1fr] max-sm:grid-cols-1">
          <SideRail
            label="Main"
            items={tabs}
            activeId="groups"
            className="static flex h-auto border-r max-sm:hidden"
            brand={<span className="font-display text-3xl">Potluck</span>}
            action={
              <Button block leadingIcon={<Plus />}>
                Add
              </Button>
            }
            footer={
              <div className="flex items-center gap-2 px-2">
                <Avatar name={me.name} seed={me.id} size="sm" />
                <span className="text-sm font-semibold">Maya</span>
              </div>
            }
          />
          <div className="relative min-h-60">
            <div className="grid h-full place-items-center p-6 text-center text-sm text-mute">
              <span className="flex items-center gap-2">
                <CalendarDays aria-hidden className="size-4" /> Content
              </span>
            </div>
            <div className="absolute inset-x-0 bottom-0">
              <div className="relative h-24">
                {/* Shown inline here; in the app it is fixed to the viewport. */}
                <TabBarPreview />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Block>
  )
}

function TabBarPreview() {
  const [active, setActive] = useState('home')
  const items = tabs.map((t) => ({ ...t, href: `#${t.id}` }))
  return (
    <BottomTabBar
      label="Main preview"
      items={items}
      activeId={active}
      centerAction={<AddButton label="Add" size="md" />}
      className="absolute lg:block"
      renderLink={({ children, href, ...props }) => (
        <button type="button" {...props} onClick={() => setActive(href.slice(1))}>
          {children}
        </button>
      )}
    />
  )
}

export function Gallery() {
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">
        <Buttons />
        <Inputs />
        <Choices />
        <Money />
        <Moments />
        <Heat />
        <Navigation />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <People />
        <Dates />
        <Overlays />
        <Feedback />
        <Lists />
        <Empty />
      </div>
    </div>
  )
}
