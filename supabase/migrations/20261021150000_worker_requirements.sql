-- Requirements raised by the worker agent (issue #2).

-- 1. Webhook signing: the worker needs the real secret to compute HMAC-SHA256.
--    Keep it in a column that only the service role can read; dashboard users can
--    write it once (shown once at creation) but never read it back.
alter table public.webhooks add column signing_secret text;
alter table public.webhooks alter column secret_hash drop not null;
revoke select (signing_secret) on public.webhooks from anon, authenticated;

-- 2. Fingerprints: SSCD is CC-BY-NC (not usable commercially). The embedding model is
--    now DINOv2 ViT-S/14 (Apache-2.0), 384 dimensions. The embedding is optional:
--    PDQ alone is enough to match re-encodes; the embedding adds robustness to crops.
drop index if exists public.fingerprints_embedding_idx;
alter table public.fingerprints drop column embedding;
alter table public.fingerprints add column embedding extensions.vector(384);
alter table public.fingerprints add column model text not null default 'pdq';
create index fingerprints_embedding_idx on public.fingerprints
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;
create index fingerprints_org_video_idx on public.fingerprints (org_id, video_id);

-- Nearest fingerprints within one organization (never across organizations).
create or replace function public.match_fingerprints(
  p_org uuid,
  p_embedding extensions.vector(384),
  p_exclude_video uuid,
  p_limit int default 20
)
returns table (video_id uuid, t_s real, similarity double precision)
language sql stable security definer set search_path = ''
as $$
  select f.video_id, f.t_s, 1 - (f.embedding operator(extensions.<=>) p_embedding) as similarity
  from public.fingerprints f
  where f.org_id = p_org
    and f.embedding is not null
    and f.video_id <> p_exclude_video
  order by f.embedding operator(extensions.<=>) p_embedding
  limit greatest(1, least(p_limit, 200));
$$;
revoke all on function public.match_fingerprints(uuid, extensions.vector, uuid, int) from public, anon, authenticated;

-- 3. Third-party models (Gemini, TwelveLabs) may only see a customer's video if the
--    organization allows it. Default off.
alter table public.organizations add column allow_external_models boolean not null default false;
