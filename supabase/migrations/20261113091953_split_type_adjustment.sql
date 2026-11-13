-- The adjustment split: an equal split plus a +/- amount per person. In its own migration
-- because a new enum value cannot be used in the transaction that adds it. ADR 10.

alter type public.split_type add value if not exists 'adjustment' before 'itemized';
