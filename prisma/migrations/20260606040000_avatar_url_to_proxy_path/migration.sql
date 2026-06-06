-- Backfill: migrate avatar URLs from absolute, backend-specific object-store
-- URLs (e.g. https://s3.example.org/<bucket>/avatars/<id>.<ext>) to the stable,
-- same-origin proxy path served by GET /api/avatar/[file]. This makes existing
-- avatars survive the MinIO -> AWS S3 (private bucket) cutover; without it those
-- rows keep pointing at a public-read URL that 403s once the bucket is private.
--
-- Safe + idempotent:
--   * only rewrites rows whose value ends in `avatars/<16+hex>.<jpg|png|webp>`
--   * skips anything already on the `/api/avatar/` proxy path
--   * a re-run (or an install with no pre-existing avatars) is a no-op
-- The captured `<id>.<ext>` filename is exactly what GET /api/avatar/[file]
-- expects.

UPDATE "users"
SET "avatarUrl" =
  '/api/avatar/' || substring("avatarUrl" from 'avatars/([0-9a-f]+\.(?:jpg|png|webp))$')
WHERE "avatarUrl" ~ 'avatars/[0-9a-f]+\.(jpg|png|webp)$'
  AND "avatarUrl" NOT LIKE '/api/avatar/%';

UPDATE "invitations"
SET "avatarUrl" =
  '/api/avatar/' || substring("avatarUrl" from 'avatars/([0-9a-f]+\.(?:jpg|png|webp))$')
WHERE "avatarUrl" ~ 'avatars/[0-9a-f]+\.(jpg|png|webp)$'
  AND "avatarUrl" NOT LIKE '/api/avatar/%';
