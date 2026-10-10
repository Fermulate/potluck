export const app = {
  name: 'Potluck',
  tagline: 'Split the bill. Pick the night. Stay friends.',
} as const

export const toast = {
  region: 'Notifications',
} as const

export const common = {
  save: 'Save',
  saving: 'Saving...',
  cancel: 'Cancel',
  close: 'Close',
  back: 'Back',
  next: 'Next',
  done: 'Done',
  edit: 'Edit',
  delete: 'Delete',
  remove: 'Remove',
  undo: 'Undo',
  retry: 'Try again',
  confirm: 'Confirm',
  continue: 'Continue',
  copy: 'Copy',
  copied: 'Copied',
  share: 'Share',
  search: 'Search',
  loading: 'Loading...',
  optional: 'Optional',
  seeAll: 'See all',
  showMore: 'Show more',
  showLess: 'Show less',
  you: 'You',
  youLower: 'you',
  and: 'and',
  today: 'Today',
  yesterday: 'Yesterday',
  tomorrow: 'Tomorrow',
  nameAndOthers_one: '{name} and {count} other',
  nameAndOthers_other: '{name} and {count} others',
  comingSoon: 'Almost ready. Check back soon.',
} as const

export const nav = {
  home: 'Home',
  groups: 'Groups',
  add: 'Add',
  plans: 'Plans',
  me: 'Me',
  quickAdd: {
    title: 'What are we doing?',
    expense: 'Add expense',
    expenseHint: 'Somebody paid for something',
    plan: 'Plan something',
    planHint: 'Find a night that works',
    settle: 'Settle up',
    settleHint: 'Square things away',
  },
} as const

export const empty = {
  groups: {
    title: 'A table for one?',
    body: 'Start a group for the people you split things with.',
    action: 'Create a group',
  },
  expenses: {
    title: 'Nothing on the tab',
    body: 'Add the first expense and let the math do the worrying.',
    action: 'Add expense',
  },
  balances: {
    title: 'All square',
    body: 'Nobody owes anybody. Frame this moment.',
    action: 'Add expense',
  },
  activity: {
    title: 'Quiet in here',
    body: 'Expenses, payments, and plans will show up as they happen.',
    action: 'Add expense',
  },
  plans: {
    title: 'No plans yet',
    body: 'Pick a few days and let everyone paint when they are free.',
    action: 'Plan something',
  },
  notifications: {
    title: 'All caught up',
    body: 'No news is good news.',
    action: 'Back home',
  },
  search: {
    title: 'Nothing matches',
    body: 'Try fewer words, or check the spelling.',
    action: 'Clear search',
  },
} as const

export const errors = {
  generic: 'Something burned in the kitchen. Try again?',
  network: 'You seem to be offline. We will retry when you are back.',
  notFound: 'That page wandered off.',
  forbidden: 'You do not have a seat at this table.',
  sessionExpired: 'Your session timed out. Sign in again.',
  rateLimited: 'Easy there. Try again in a moment.',
  updateRequired: 'This version is out of date. Refresh to get the latest.',
  auth: {
    invalidCredentials: 'That email and password do not match.',
    emailTaken: 'That email already has an account. Try signing in.',
    weakPassword: 'Pick a longer password.',
    emailNotConfirmed: 'Confirm your email first. Check your inbox.',
  },
  split: {
    invalid_total: 'Enter an amount greater than zero.',
    no_users: 'Pick at least one person to split with.',
    duplicate_user: 'Someone is in this split twice.',
    invalid_amount: 'Amounts must be zero or more.',
    sum_mismatch: 'The amounts need to add up to the total.',
    invalid_weight: 'Use zero or a positive number.',
    percent_sum: 'Percentages need to add up to 100%.',
    zero_shares: 'Give at least one person a share.',
    no_items: 'Add at least one item.',
    item_no_users: 'Every item needs at least one person.',
    invalid_item_amount: 'Item prices must be zero or more.',
    invalid_extra: 'Tax and tip must be zero or more.',
  },
  validation: {
    required: 'Required.',
    tooLong: 'That is a bit long.',
    invalidEmail: 'That email does not look right.',
    invalidAmount: 'Enter a valid amount.',
    invalid_currency: 'Pick a currency.',
    splits_sum_mismatch: 'The split needs to add up to the total.',
    duplicate_split_user: 'Someone is in this split twice.',
    percent_sum: 'Percentages need to add up to 100%.',
    shares_required: 'Everyone in the split needs at least some shares.',
    invalid_slot_size: 'Pick 15, 30, or 60 minute slots.',
    window_end_before_start: 'The last day comes before the first day.',
    window_too_long: 'Keep the window to about two months.',
    day_end_before_start: 'The day has to end after it starts.',
    duration_too_long: 'The event is longer than the hours you picked.',
  },
} as const
