-- Storage buckets and object policies.
--   avatars       public read, owner writes  <user_id>/...
--   group-covers  public read, group owner/admin writes  <group_id>/...
--   receipts      private, group members read and upload  <group_id>/...;
--                 the uploader or a group admin can replace/delete

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('group-covers', 'group-covers', true, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('receipts', 'receipts', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- avatars ---------------------------------------------------------------------

create policy "avatars: public read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'avatars');

create policy "avatars: owner upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "avatars: owner update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "avatars: owner delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- group-covers ----------------------------------------------------------------

create policy "group-covers: public read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'group-covers');

create policy "group-covers: admins upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'group-covers'
  and private.is_group_admin(private.try_uuid((storage.foldername(name))[1]))
);

create policy "group-covers: admins update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'group-covers'
  and private.is_group_admin(private.try_uuid((storage.foldername(name))[1]))
)
with check (
  bucket_id = 'group-covers'
  and private.is_group_admin(private.try_uuid((storage.foldername(name))[1]))
);

create policy "group-covers: admins delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'group-covers'
  and private.is_group_admin(private.try_uuid((storage.foldername(name))[1]))
);

-- receipts --------------------------------------------------------------------

create policy "receipts: members read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'receipts'
  and private.try_uuid((storage.foldername(name))[1]) in (select private.my_group_ids())
);

create policy "receipts: members upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and private.try_uuid((storage.foldername(name))[1]) in (select private.my_group_ids())
);

create policy "receipts: uploader or admin update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'receipts'
  and private.try_uuid((storage.foldername(name))[1]) in (select private.my_group_ids())
  and (
    owner_id = (select auth.uid())::text
    or private.is_group_admin(private.try_uuid((storage.foldername(name))[1]))
  )
)
with check (
  bucket_id = 'receipts'
  and private.try_uuid((storage.foldername(name))[1]) in (select private.my_group_ids())
);

create policy "receipts: uploader or admin delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'receipts'
  and private.try_uuid((storage.foldername(name))[1]) in (select private.my_group_ids())
  and (
    owner_id = (select auth.uid())::text
    or private.is_group_admin(private.try_uuid((storage.foldername(name))[1]))
  )
);
