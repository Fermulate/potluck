-- Every 2 weeks (Splitwise's "fortnightly"). In its own migration because a new enum value
-- cannot be used in the transaction that adds it. ADR 14.

alter type public.recurrence add value if not exists 'biweekly' after 'weekly';
