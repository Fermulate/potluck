/** Quick polls: availability polls anyone can make and answer without an account (ADR 22). */
export const quickPolls = {
  /** Server codes the quick poll screens show, `errorMessage(error, 'quickPolls.errors')`. */
  errors: {
    quick_poll_not_found: 'That poll link does not lead anywhere.',
    quick_poll_expired: 'This poll has ended.',
    quick_poll_closed: 'This poll is closed, so the times are final.',
    quick_poll_full: 'Every spot in this poll is taken.',
    quick_poll_rate_limited: 'Easy there. Try again a little later.',
    quick_poll_slots_required: 'Paint at least one time first.',
    invalid_quick_poll: 'Something in this poll is not right. Check it and try again.',
    invalid_quick_poll_title: 'Titles are up to 80 characters.',
    invalid_quick_poll_timezone: 'Pick a time zone from the list.',
    invalid_quick_poll_window: 'Pick 1 to 14 days, not all in the past.',
    invalid_quick_poll_hours: 'The day has to end at least one slot after it starts.',
    invalid_quick_poll_slot_minutes: 'Pick 30 or 60 minute slots.',
    invalid_quick_poll_duration: 'Plans last 15 minutes to 24 hours.',
    invalid_quick_poll_ttl: 'Pick how long the poll stays open.',
    invalid_quick_poll_people: 'A poll takes 2 to 15 people.',
    invalid_quick_poll_name: 'Names are 1 to 40 characters.',
    invalid_slot: 'Some of those times are outside the poll.',
    invalid_slots: 'Those times did not save. Try again?',
    duplicate_slot: 'A time showed up twice. Try again?',
    not_allowed: 'Only whoever made the poll can do that.',
  },
}
