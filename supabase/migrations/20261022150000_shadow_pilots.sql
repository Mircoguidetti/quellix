-- Shadow-mode pilots (issue #65): a collector sends videos its reviewers already judged; Ormes
-- runs alongside (no webhooks, nothing to contributors) and reports against criteria agreed
-- before the run.

alter table public.videos add column shadow boolean not null default false;
-- A pilot row may point at the collector's own signed URL instead of an upload. The worker fetches
-- it into a temporary directory and clears this column once the decision is written.
alter table public.videos add column source_url text check (source_url is null or source_url like 'https://%');
create index videos_org_shadow_created_idx on public.videos (org_id, created_at desc) where shadow;

create table public.pilots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  rubric_id uuid not null,
  rubric_version int not null,
  criteria jsonb not null check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) between 1 and 8),
  default_review_minutes real check (default_review_minutes is null or default_review_minutes > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (rubric_id, rubric_version) references public.rubric_versions(rubric_id, version)
);
create index pilots_org_created_idx on public.pilots (org_id, created_at desc);

-- The success criteria are agreed before the run: never changed afterwards.
create function public.pilots_criteria_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.criteria is distinct from old.criteria or new.rubric_id <> old.rubric_id
     or new.rubric_version <> old.rubric_version then
    raise exception 'a pilot''s criteria and rubric cannot change after it is created';
  end if;
  return new;
end $$;
create trigger pilots_criteria_immutable before update on public.pilots
  for each row execute function public.pilots_criteria_immutable();

create table public.pilot_items (
  id uuid primary key default gen_random_uuid(),
  pilot_id uuid not null references public.pilots(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  external_id text not null check (char_length(external_id) between 1 and 200),
  reviewer_decision public.final_value not null,
  reviewer_minutes real check (reviewer_minutes is null or reviewer_minutes between 0 and 600),
  lab_outcome public.final_value,
  contributor_ref text check (contributor_ref is null or char_length(contributor_ref) <= 200),
  source_url text check (source_url is null or source_url like 'https://%'),
  video_id uuid unique references public.videos(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (pilot_id, external_id)
);
create index pilot_items_org_pilot_idx on public.pilot_items (org_id, pilot_id);

alter table public.pilots enable row level security;
alter table public.pilot_items enable row level security;

create policy pilots_read on public.pilots for select using (public.is_member(org_id));
create policy pilots_write on public.pilots for all using (public.is_admin(org_id)) with check (public.is_admin(org_id));
create policy pilot_items_read on public.pilot_items for select using (public.is_member(org_id));
create policy pilot_items_write on public.pilot_items for all using (public.is_admin(org_id)) with check (public.is_admin(org_id));
