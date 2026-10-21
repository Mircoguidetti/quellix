-- Founder data rule: a video is deleted after analysis, except a `review` video, which is kept
-- until a person decides it and at most 14 days. The worker sets delete_after when it keeps a
-- file; a daily job deletes files whose delete_after has passed.
alter table public.videos add column delete_after timestamptz;

-- Only rows that still hold a file and have a deadline are ever scanned.
create index videos_delete_after_idx on public.videos (delete_after)
  where storage_path is not null and delete_after is not null;
