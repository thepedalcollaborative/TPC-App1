-- Add video fields to weekly_picks so the YouTube data is cached with the pick.
ALTER TABLE public.weekly_picks
  ADD COLUMN IF NOT EXISTS video_id    text,
  ADD COLUMN IF NOT EXISTS video_title text,
  ADD COLUMN IF NOT EXISTS is_tpc_video boolean NOT NULL DEFAULT false;
