import type { PlanEvent, PlanEventStatus, PlanEventWithGroup, PlanTimelineItem } from '@potluck/api'

/** What a plan row needs, whether it came from `my_timeline` or the events table. */
export interface PlanRowData {
  id: string
  groupId: string
  title: string
  emoji: string | null
  status: PlanEventStatus
  startsAt: string | null
  endsAt: string | null
  windowStart: string
  windowEnd: string
  location: string | null
  groupName?: string
  groupEmoji?: string | null
  goingCount?: number
  /** The viewer was asked for times (or has not given any) on an open poll. */
  needsTimes?: boolean
  /** Scheduled and the viewer has not answered. */
  needsRsvp?: boolean
}

export function fromTimeline(item: PlanTimelineItem): PlanRowData {
  return {
    id: item.event_id,
    groupId: item.group_id,
    title: item.title,
    emoji: item.emoji,
    status: item.status,
    startsAt: item.starts_at,
    endsAt: item.ends_at,
    windowStart: item.window_start,
    windowEnd: item.window_end,
    location: item.location,
    groupName: item.group_name,
    groupEmoji: item.group_emoji,
    goingCount: item.going_count,
    needsTimes: item.status === 'polling' && !item.availability_submitted,
    needsRsvp: item.status === 'scheduled' && !item.my_rsvp,
  }
}

export function fromEvent(event: PlanEvent | PlanEventWithGroup): PlanRowData {
  const group = 'group' in event ? event.group : null
  return {
    id: event.id,
    groupId: event.group_id,
    title: event.title,
    emoji: event.emoji,
    status: event.status,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    windowStart: event.window_start,
    windowEnd: event.window_end,
    location: event.location,
    groupName: group?.name,
    groupEmoji: group?.emoji,
  }
}
