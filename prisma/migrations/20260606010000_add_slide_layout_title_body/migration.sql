-- Add TITLE_BODY to the SlideLayout enum.
-- This layout stores free-form paragraph text in bullets[0] (no bullet markers).
-- ADD VALUE IF NOT EXISTS is safe to replay against DBs already patched via db push.
ALTER TYPE "SlideLayout" ADD VALUE IF NOT EXISTS 'TITLE_BODY';
