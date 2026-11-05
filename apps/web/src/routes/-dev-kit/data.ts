// Fake data for the design kit only. Nothing here talks to Supabase.

export const people = [
  { id: 'u-maya', name: 'Maya Okafor' },
  { id: 'u-theo', name: 'Theo Lindqvist' },
  { id: 'u-priya', name: 'Priya Raman' },
  { id: 'u-sam', name: 'Sam Ortiz' },
  { id: 'u-jun', name: 'Jun Park' },
  { id: 'u-ines', name: 'Inês Duarte' },
  { id: 'u-kofi', name: 'Kofi Mensah' },
] as const

export type Person = (typeof people)[number]

export function person(id: Person['id']): Person {
  return people.find((p) => p.id === id)!
}

export const me = person('u-maya')

/** A fixed "today" so the kit renders the same every time. */
export const today = new Date('2026-11-12T18:00:00')

export function day(offset: number, hour = 19, minute = 30): Date {
  const d = new Date(today)
  d.setDate(d.getDate() + offset)
  d.setHours(hour, minute, 0, 0)
  return d
}

export const balances = {
  net: 24850,
  owe: 3620,
  owed: 28470,
}

export const needsYou = [
  {
    id: 'n1',
    kind: 'availability' as const,
    title: 'When are you free for ramen?',
    group: 'Thursday regulars',
    emoji: '🍜',
    from: person('u-theo'),
    replied: 5,
    total: 7,
  },
  {
    id: 'n2',
    kind: 'settle' as const,
    title: 'You owe Priya for the cabin',
    group: 'Cabin crew',
    emoji: '🏕️',
    from: person('u-priya'),
    cents: -3620,
  },
  {
    id: 'n3',
    kind: 'rsvp' as const,
    title: 'Lake day is locked in',
    group: 'Cabin crew',
    emoji: '🛶',
    from: person('u-jun'),
    when: day(10, 10, 0),
  },
]

export const upcoming = [
  {
    id: 'e1',
    title: 'Ramen at Ippudo',
    group: 'Thursday regulars',
    when: day(1, 19, 30),
    where: 'Ippudo, 4th Ave',
    going: ['u-theo', 'u-jun', 'u-ines', 'u-kofi', 'u-sam'] as const,
    status: 'scheduled' as const,
  },
  {
    id: 'e2',
    title: 'Friendsgiving',
    group: 'Old flatmates',
    when: day(14, 17, 0),
    where: "Priya's place",
    going: ['u-priya', 'u-sam', 'u-ines'] as const,
    status: 'polling' as const,
  },
  {
    id: 'e3',
    title: 'Lake day',
    group: 'Cabin crew',
    when: day(10, 10, 0),
    where: 'Wildcat Lake',
    going: ['u-jun', 'u-theo', 'u-priya', 'u-kofi'] as const,
    status: 'scheduled' as const,
  },
]

/** Availability grid: 5 days x 9 half-hour slots (6pm to 10:30pm), counts out of 7. */
export const heatDays = [day(1), day(2), day(3), day(4), day(5)]
export const heatTimes = ['6:00', '6:30', '7:00', '7:30', '8:00', '8:30', '9:00', '9:30', '10:00']
export const heatCounts: number[][] = [
  // rows are times, columns are days
  [0, 1, 2, 0, 1],
  [1, 2, 3, 1, 2],
  [2, 3, 5, 2, 3],
  [2, 4, 6, 3, 2],
  [3, 4, 6, 3, 1],
  [2, 3, 6, 4, 1],
  [1, 2, 5, 3, 0],
  [0, 1, 3, 2, 0],
  [0, 0, 1, 1, 0],
]
export const heatBusy: Array<[number, number]> = [
  [0, 3],
  [1, 3],
  [7, 4],
  [8, 4],
]
export const mySlots: Array<[number, number]> = [
  [3, 2],
  [4, 2],
  [5, 2],
  [4, 1],
]
/** Best slot: column 2 (Sun), rows 3 to 6 (7:30 to 9:30). */
export const best = { col: 2, from: 3, to: 6 }

export const timeline = [
  {
    label: 'Today',
    items: [
      {
        id: 't1',
        kind: 'expense' as const,
        who: person('u-priya'),
        what: 'Groceries for the cabin',
        emoji: '🧺',
        cents: 18600,
        yourShare: -3100,
        time: '2:14 pm',
      },
      {
        id: 't2',
        kind: 'settlement' as const,
        who: person('u-theo'),
        cents: 5000,
        time: '11:02 am',
      },
    ],
  },
  {
    label: 'Yesterday',
    items: [
      {
        id: 't3',
        kind: 'event' as const,
        who: person('u-jun'),
        what: 'Lake day',
        emoji: '🛶',
        when: day(10, 10, 0),
        going: 4,
        time: '8:40 pm',
      },
      {
        id: 't4',
        kind: 'expense' as const,
        who: me,
        what: 'Gas, both cars',
        emoji: '⛽',
        cents: 9240,
        yourShare: 7700,
        time: '6:15 pm',
      },
    ],
  },
  {
    label: 'Nov 8',
    items: [
      {
        id: 't5',
        kind: 'joined' as const,
        who: person('u-kofi'),
        time: '9:30 am',
      },
    ],
  },
]
