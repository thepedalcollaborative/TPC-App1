-- Add opt-out flag for community activity trends.
-- When false, the user's vault/wishlist additions are excluded from
-- the trending pedals feed and community signals counts.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS allow_activity_in_trends boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.user_profiles.allow_activity_in_trends IS
  'When false, exclude this user from community trend counts and the trending home feed.';
