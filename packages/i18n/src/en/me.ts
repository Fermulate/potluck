export const notifications = {
  title: 'Notifications',
  markAllRead: 'Mark all as read',
  allCaughtUp: 'All caught up.',
  unread_one: '{count} unread',
  unread_other: '{count} unread',
  enablePush: 'Turn on push notifications',
  pushBlocked: 'Notifications are blocked in your browser settings.',
  types: {
    expense: {
      created: { title: 'New expense in {group}', body: '{actor} added {description}: {amount}' },
      updated: { title: 'Expense updated', body: '{actor} changed {description} in {group}' },
    },
    settlement: {
      created: { title: 'You got paid', body: '{actor} paid you {amount}' },
    },
    member: {
      joined: { title: 'New face in {group}', body: '{actor} just joined. Say hi.' },
    },
    event: {
      created: { title: 'Something is cooking', body: '{actor} is planning {event}' },
      scheduled: { title: "It's a date", body: '{event} is on for {date}' },
      cancelled: { title: 'Plans changed', body: '{event} was called off' },
      reminder: { title: 'Coming up', body: '{event} starts {when}' },
    },
    availability: {
      requested: {
        title: 'When are you free?',
        body: '{actor} needs your availability for {event}',
      },
    },
    rsvp: {
      reminder: { title: 'Are you in?', body: 'Let {group} know if you are coming to {event}' },
    },
    comment: {
      created: { title: 'New comment', body: '{actor}: {preview}' },
    },
  },
} as const

export const settings = {
  title: 'Me',
  profile: {
    title: 'Profile',
    name: 'Display name',
    photo: 'Photo',
    changePhoto: 'Change photo',
    removePhoto: 'Remove photo',
    email: 'Email',
    saved: 'Profile saved.',
  },
  preferences: {
    title: 'Preferences',
    timezone: 'Time zone',
    timezoneHint: 'Times show up in this zone.',
    detectTimezone: 'Use my current time zone',
    currency: 'Default currency',
    currencyHint: 'Used for new groups.',
    language: 'Language',
    theme: 'Appearance',
    themeSystem: 'Match my device',
    themeLight: 'Light',
    themeDark: 'Dark',
  },
  notifications: {
    title: 'Notifications',
    push: 'Push notifications',
    email: 'Email notifications',
    expenses: 'New expenses',
    payments: 'Payments',
    plans: 'Plans and availability requests',
    reminders: 'Event reminders',
  },
  calendar: {
    title: 'Calendar',
    feed: 'Calendar feed',
    feedHint: 'Subscribe to your Potluck plans from any calendar app.',
    copyFeed: 'Copy feed link',
    resetFeed: 'Reset link',
    resetFeedHint: 'The old link stops working.',
    connect: 'Connect a calendar',
    connectHint: 'We only read when you are busy, never what you are doing.',
    connected: 'Connected',
    disconnect: 'Disconnect',
    comingSoon: 'Coming soon',
  },
  privacy: {
    title: 'Privacy',
    blocked: 'Blocked people',
    noneBlocked: 'Nobody blocked. Lovely.',
    unblock: 'Unblock',
  },
  about: {
    title: 'About',
    version: 'Version {version}',
    source: 'Source code',
    license: 'Free software under the AGPL-3.0',
    feedback: 'Send feedback',
  },
} as const

export const account = {
  delete: {
    title: 'Delete account',
    warning:
      'This removes your profile, photo, and email. Expenses you were part of stay, so group totals still add up, but they will show "Former member" instead of your name.',
    blocked: 'You still have open balances in {groups}. Settle up first.',
    ownerBlocked: 'You own {groups}. Hand them to someone else first.',
    confirmPhrase: 'Type DELETE to confirm',
    confirmWord: 'DELETE',
    submit: 'Delete my account',
    deleting: 'Clearing your place at the table...',
    done: 'Your account is gone. Thanks for every dinner.',
    formerMember: 'Former member',
  },
  export: {
    title: 'Download my data',
    hint: 'A copy of your expenses, payments, and plans.',
    ready: 'Your export is ready.',
  },
}

/** Empty states: serif italic headline, one line, one clear action. */
