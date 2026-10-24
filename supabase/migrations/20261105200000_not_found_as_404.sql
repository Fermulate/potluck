-- "Not found" errors from RPCs used SQLSTATE P0002, which PostgREST answers
-- with HTTP 500. PT404 keeps the same message codes (invite_not_found, ...)
-- but answers 404, so clients and monitoring do not see a server error.
--
-- Rewrites every function in public and private whose body raises P0002.
-- Signatures, privileges and behavior are otherwise unchanged.

do $$
declare
  fn record;
  def text;
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and p.prosrc like '%''P0002''%'
  loop
    def := pg_get_functiondef(fn.oid);
    def := replace(def, 'errcode = ''P0002''', 'errcode = ''PT404''');
    execute def;
  end loop;
end;
$$;
