-- Community signals cache table
CREATE TABLE IF NOT EXISTS public.community_signals_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type text NOT NULL,
  payload jsonb NOT NULL,
  computed_at timestamptz DEFAULT now()
);
ALTER TABLE public.community_signals_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only for signals cache"
  ON public.community_signals_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Recommendation feedback table
CREATE TABLE IF NOT EXISTS public.recommendation_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  pedal_brand text,
  pedal_model text,
  outcome text NOT NULL,        -- 'accepted' | 'rejected'
  rejection_reason text,
  profile_snapshot jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.recommendation_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own feedback"
  ON public.recommendation_feedback
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can read own feedback"
  ON public.recommendation_feedback
  FOR SELECT
  USING (auth.uid() = user_id);

-- Performance index for community signal pairing queries
CREATE INDEX IF NOT EXISTS idx_user_pedals_pedal_id_status
  ON public.user_pedals(pedal_id, status);
