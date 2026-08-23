-- dx-sensor: support for cloud-reachable cameras (e.g. soracam vendor)
-- that are polled directly by a Vercel Cron job rather than a local agent.

alter table cameras
  add column if not exists last_frame_path text; -- Storage path of the most recent frame, used for diffing across stateless invocations

alter table cameras
  add column if not exists soracam_device_id text,
  add column if not exists soracam_auth_key_id text,
  add column if not exists soracam_secret_ref text; -- reference to the resolved auth key secret, same non-persistence pattern as `cameras.secret_ref`
