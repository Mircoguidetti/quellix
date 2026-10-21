-- Storage bucket for customer videos and the pgmq_public queue API.

-- ---------------------------------------------------------------- storage
-- Private bucket. Paths: org/<org_id>/<video_id>/<filename>.
insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do update set public = false;

-- Members of an organization can read and write only under org/<their org_id>/.
-- The service role (worker, API) bypasses RLS.
drop policy if exists videos_objects_read on storage.objects;
create policy videos_objects_read on storage.objects for select to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1 from public.members m
      where m.user_id = (select auth.uid())
        and m.org_id::text = (storage.foldername(name))[2]
    )
  );

drop policy if exists videos_objects_insert on storage.objects;
create policy videos_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1 from public.members m
      where m.user_id = (select auth.uid())
        and m.org_id::text = (storage.foldername(name))[2]
    )
  );

drop policy if exists videos_objects_update on storage.objects;
create policy videos_objects_update on storage.objects for update to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1 from public.members m
      where m.user_id = (select auth.uid())
        and m.org_id::text = (storage.foldername(name))[2]
    )
  )
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1 from public.members m
      where m.user_id = (select auth.uid())
        and m.org_id::text = (storage.foldername(name))[2]
    )
  );

drop policy if exists videos_objects_delete on storage.objects;
create policy videos_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1 from public.members m
      where m.user_id = (select auth.uid())
        and m.org_id::text = (storage.foldername(name))[2]
    )
  );

-- ---------------------------------------------------------------- pgmq_public
-- Same surface as Supabase Queues ("Expose Queues via PostgREST"), but only the
-- service role may call it. The schema must also be listed in the API's exposed
-- schemas (supabase/config.toml, or Dashboard > API settings).
create schema if not exists pgmq_public;
grant usage on schema pgmq_public to service_role;

create or replace function pgmq_public.send(queue_name text, message jsonb, sleep_seconds integer default 0)
returns setof bigint
language plpgsql security definer set search_path = ''
as $$ begin return query select * from pgmq.send(queue_name, message, sleep_seconds); end $$;

create or replace function pgmq_public.send_batch(queue_name text, messages jsonb[], sleep_seconds integer default 0)
returns setof bigint
language plpgsql security definer set search_path = ''
as $$ begin return query select * from pgmq.send_batch(queue_name, messages, sleep_seconds); end $$;

create or replace function pgmq_public.read(queue_name text, sleep_seconds integer, n integer)
returns setof pgmq.message_record
language plpgsql security definer set search_path = ''
as $$ begin return query select * from pgmq.read(queue_name, sleep_seconds, n); end $$;

create or replace function pgmq_public.pop(queue_name text)
returns setof pgmq.message_record
language plpgsql security definer set search_path = ''
as $$ begin return query select * from pgmq.pop(queue_name); end $$;

create or replace function pgmq_public.archive(queue_name text, message_id bigint)
returns boolean
language plpgsql security definer set search_path = ''
as $$ begin return pgmq.archive(queue_name, message_id); end $$;

create or replace function pgmq_public.delete(queue_name text, message_id bigint)
returns boolean
language plpgsql security definer set search_path = ''
as $$ begin return pgmq.delete(queue_name, message_id); end $$;

-- Nobody but the service role can call the wrappers.
revoke all on function pgmq_public.send(text, jsonb, integer) from public, anon, authenticated;
revoke all on function pgmq_public.send_batch(text, jsonb[], integer) from public, anon, authenticated;
revoke all on function pgmq_public.read(text, integer, integer) from public, anon, authenticated;
revoke all on function pgmq_public.pop(text) from public, anon, authenticated;
revoke all on function pgmq_public.archive(text, bigint) from public, anon, authenticated;
revoke all on function pgmq_public.delete(text, bigint) from public, anon, authenticated;
grant execute on function pgmq_public.send(text, jsonb, integer) to service_role;
grant execute on function pgmq_public.send_batch(text, jsonb[], integer) to service_role;
grant execute on function pgmq_public.read(text, integer, integer) to service_role;
grant execute on function pgmq_public.pop(text) to service_role;
grant execute on function pgmq_public.archive(text, bigint) to service_role;
grant execute on function pgmq_public.delete(text, bigint) to service_role;
