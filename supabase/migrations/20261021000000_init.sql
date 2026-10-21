-- Quellix initial schema.
-- Multi-tenant by organization. Every table carrying customer data has org_id and RLS.
-- The worker uses the service role (bypasses RLS); dashboard users go through RLS.

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- enums
create type public.member_role as enum ('owner', 'admin', 'reviewer');
create type public.video_status as enum ('awaiting_upload', 'queued', 'processing', 'decided', 'failed', 'deleted');
create type public.decision_value as enum ('accept', 'reject', 'review');
create type public.final_value as enum ('accept', 'reject');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed');
create type public.contest_status as enum ('open', 'upheld', 'overturned');

-- ---------------------------------------------------------------- organizations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  -- Customer videos are never used for training unless this is true (explicit opt-in).
  training_opt_in boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'reviewer',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  prefix text not null,              -- first characters, shown in the dashboard
  key_hash text not null unique,     -- sha256 of the full key; the key itself is never stored
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  url text not null check (url like 'https://%'),
  secret_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- rubrics (versioned)
create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  current_version int not null default 1,
  created_at timestamptz not null default now()
);

create table public.rubric_versions (
  rubric_id uuid not null references public.rubrics(id) on delete cascade,
  version int not null check (version >= 1),
  body jsonb not null,               -- validated against packages/contracts/rubric.schema.json
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (rubric_id, version)
);

-- ---------------------------------------------------------------- videos and processing
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  external_id text,
  contributor_ref text,              -- opaque id from the collector, never a name or email
  rubric_id uuid not null references public.rubrics(id),
  rubric_version int not null,
  status public.video_status not null default 'awaiting_upload',
  storage_path text,                 -- cleared when the file is deleted after analysis
  filename text,
  content_type text,
  size_bytes bigint,
  duration_s real,
  created_at timestamptz not null default now(),
  file_deleted_at timestamptz,
  foreign key (rubric_id, rubric_version) references public.rubric_versions(rubric_id, version)
);
create index videos_org_created_idx on public.videos (org_id, created_at desc);
create unique index videos_org_external_idx on public.videos (org_id, external_id) where external_id is not null;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  status public.job_status not null default 'queued',
  attempts int not null default 0,
  error text,
  cost_usd numeric(10, 5),           -- compute + model API cost of this job
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_video_idx on public.jobs (video_id);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  decision public.decision_value not null,
  reasons jsonb not null default '[]',
  checks jsonb not null default '{}',
  rubric_id uuid not null,
  rubric_version int not null,
  engine_version text not null,
  created_at timestamptz not null default now()
);
create index decisions_video_idx on public.decisions (video_id, created_at desc);
create index decisions_org_review_idx on public.decisions (org_id, created_at desc) where decision = 'review';

-- Human reviewer's final decision (the simple review list in v1).
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  reviewer_id uuid references auth.users(id),
  decision public.final_value not null,
  note text,
  created_at timestamptz not null default now()
);
create index reviews_video_idx on public.reviews (video_id, created_at desc);

-- What the lab decided. Ground truth for precision / recall when available.
create table public.lab_outcomes (
  video_id uuid primary key references public.videos(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  outcome public.final_value not null,
  reason text,
  received_at timestamptz not null default now()
);

-- A contributor contesting a rejection. Always resolved by a person.
create table public.contests (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  contributor_ref text,
  message text not null check (char_length(message) <= 4000),
  status public.contest_status not null default 'open',
  resolution_note text,
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Fingerprints for originality. Scoped to the org: no cross-customer matching in v1.
create table public.fingerprints (
  id bigint generated always as identity primary key,
  video_id uuid not null references public.videos(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  t_s real not null,                 -- timestamp of the sampled frame
  embedding extensions.vector(512) not null,  -- SSCD copy-detection descriptor
  pdq bytea                          -- 256-bit perceptual hash
);
create index fingerprints_org_idx on public.fingerprints (org_id);
create index fingerprints_embedding_idx on public.fingerprints
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------- RLS
create or replace function public.is_member(target_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.org_id = target_org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_admin(target_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.org_id = target_org and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

alter table public.organizations enable row level security;
alter table public.members enable row level security;
alter table public.api_keys enable row level security;
alter table public.webhooks enable row level security;
alter table public.rubrics enable row level security;
alter table public.rubric_versions enable row level security;
alter table public.videos enable row level security;
alter table public.jobs enable row level security;
alter table public.decisions enable row level security;
alter table public.reviews enable row level security;
alter table public.lab_outcomes enable row level security;
alter table public.contests enable row level security;
alter table public.fingerprints enable row level security;

create policy org_read on public.organizations for select using (public.is_member(id));
create policy org_update on public.organizations for update using (public.is_admin(id));

create policy members_read on public.members for select using (public.is_member(org_id));
create policy members_admin on public.members for all using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy api_keys_admin on public.api_keys for all using (public.is_admin(org_id)) with check (public.is_admin(org_id));
create policy webhooks_admin on public.webhooks for all using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy rubrics_read on public.rubrics for select using (public.is_member(org_id));
create policy rubrics_write on public.rubrics for all using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy rubric_versions_read on public.rubric_versions for select
  using (exists (select 1 from public.rubrics r where r.id = rubric_id and public.is_member(r.org_id)));
create policy rubric_versions_insert on public.rubric_versions for insert
  with check (exists (select 1 from public.rubrics r where r.id = rubric_id and public.is_admin(r.org_id)));

create policy videos_read on public.videos for select using (public.is_member(org_id));
create policy jobs_read on public.jobs for select
  using (exists (select 1 from public.videos v where v.id = video_id and public.is_member(v.org_id)));
create policy decisions_read on public.decisions for select using (public.is_member(org_id));

create policy reviews_read on public.reviews for select using (public.is_member(org_id));
create policy reviews_insert on public.reviews for insert
  with check (public.is_member(org_id) and reviewer_id = (select auth.uid()));

create policy lab_outcomes_read on public.lab_outcomes for select using (public.is_member(org_id));
create policy lab_outcomes_write on public.lab_outcomes for all using (public.is_member(org_id)) with check (public.is_member(org_id));

create policy contests_read on public.contests for select using (public.is_member(org_id));
create policy contests_resolve on public.contests for update using (public.is_member(org_id));

-- fingerprints: no user policies; only the worker (service role) reads and writes them.

-- ---------------------------------------------------------------- queue
-- Supabase Queues (pgmq). The API enqueues { "job_id": ..., "video_id": ... }; the worker reads it.
create extension if not exists pgmq;
select pgmq.create('video_jobs');
