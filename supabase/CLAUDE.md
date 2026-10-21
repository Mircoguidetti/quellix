# supabase

Database schema for Quellix (Postgres on Supabase, EU region).

- `migrations/` - append-only. Add a new file `YYYYMMDDHHMMSS_<name>.sql`; never edit one that has been applied.
- Every table with customer data has `org_id` and Row Level Security. Dashboard users go through RLS (`is_member`, `is_admin`); the worker and the API's server-side code use the service role.
- Videos are deleted from storage after analysis: set `videos.storage_path = null` and `file_deleted_at`.
- `organizations.training_opt_in` is the only switch that allows a customer's data to be used for training.
- Fingerprints never cross organizations in v1.
- Storage bucket (create in the dashboard or a migration): `videos`, private, paths `org/<org_id>/<video_id>/<filename>`.
