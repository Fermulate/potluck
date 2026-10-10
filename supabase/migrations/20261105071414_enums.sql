create type public.group_role as enum ('owner', 'admin', 'member');
create type public.split_type as enum ('equal', 'exact', 'percent', 'shares', 'itemized');
create type public.event_status as enum ('polling', 'scheduled', 'cancelled', 'done');
create type public.availability_level as enum ('yes', 'maybe');
create type public.rsvp_status as enum ('going', 'maybe', 'declined');
create type public.push_platform as enum ('web', 'ios', 'android');
create type public.recurrence as enum ('weekly', 'monthly', 'yearly');
