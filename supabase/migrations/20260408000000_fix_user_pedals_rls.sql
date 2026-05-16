-- Fix RLS policies on user_pedals so authenticated users can manage their own rows.

ALTER TABLE public.user_pedals ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies first to avoid conflicts
DROP POLICY IF EXISTS "Users can view own pedals"       ON public.user_pedals;
DROP POLICY IF EXISTS "Users can insert own pedals"     ON public.user_pedals;
DROP POLICY IF EXISTS "Users can update own pedals"     ON public.user_pedals;
DROP POLICY IF EXISTS "Users can delete own pedals"     ON public.user_pedals;
DROP POLICY IF EXISTS "user_pedals_select"              ON public.user_pedals;
DROP POLICY IF EXISTS "user_pedals_insert"              ON public.user_pedals;
DROP POLICY IF EXISTS "user_pedals_update"              ON public.user_pedals;
DROP POLICY IF EXISTS "user_pedals_delete"              ON public.user_pedals;

CREATE POLICY "user_pedals_select" ON public.user_pedals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_pedals_insert" ON public.user_pedals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_pedals_update" ON public.user_pedals
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "user_pedals_delete" ON public.user_pedals
  FOR DELETE USING (auth.uid() = user_id);
