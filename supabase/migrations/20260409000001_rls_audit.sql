-- RLS audit — enable Row Level Security on tables that were missing it.
-- Each table gets the minimum policies required for the app to function.
-- Run this before any public/TestFlight release.

-- ─── pedals ──────────────────────────────────────────────────────────────────
-- Public catalog: anyone can read, only service-role edge functions write.
ALTER TABLE public.pedals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedals_public_read" ON public.pedals;
CREATE POLICY "pedals_public_read"
  ON public.pedals FOR SELECT
  USING (true);

-- ─── user_profiles ───────────────────────────────────────────────────────────
-- Each user owns exactly one row (id = auth.uid()).
-- Inserts are handled by the handle_new_user() trigger (service role).
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles_select_own" ON public.user_profiles;
CREATE POLICY "user_profiles_select_own"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "user_profiles_update_own" ON public.user_profiles;
CREATE POLICY "user_profiles_update_own"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ─── boards ──────────────────────────────────────────────────────────────────
-- Users manage their own boards only.
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "boards_select_own" ON public.boards;
CREATE POLICY "boards_select_own"
  ON public.boards FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "boards_insert_own" ON public.boards;
CREATE POLICY "boards_insert_own"
  ON public.boards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "boards_update_own" ON public.boards;
CREATE POLICY "boards_update_own"
  ON public.boards FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "boards_delete_own" ON public.boards;
CREATE POLICY "boards_delete_own"
  ON public.boards FOR DELETE
  USING (auth.uid() = user_id);

-- ─── board_slots ─────────────────────────────────────────────────────────────
-- Board slots belong to boards which belong to users.
-- Join through boards to check ownership.
ALTER TABLE public.board_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "board_slots_select_own" ON public.board_slots;
CREATE POLICY "board_slots_select_own"
  ON public.board_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_slots.board_id
        AND boards.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "board_slots_insert_own" ON public.board_slots;
CREATE POLICY "board_slots_insert_own"
  ON public.board_slots FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_slots.board_id
        AND boards.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "board_slots_update_own" ON public.board_slots;
CREATE POLICY "board_slots_update_own"
  ON public.board_slots FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_slots.board_id
        AND boards.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "board_slots_delete_own" ON public.board_slots;
CREATE POLICY "board_slots_delete_own"
  ON public.board_slots FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE boards.id = board_slots.board_id
        AND boards.user_id = auth.uid()
    )
  );

-- ─── pedal_colorways ─────────────────────────────────────────────────────────
-- Public catalog: anyone can read, only service-role edge functions write.
ALTER TABLE public.pedal_colorways ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedal_colorways_public_read" ON public.pedal_colorways;
CREATE POLICY "pedal_colorways_public_read"
  ON public.pedal_colorways FOR SELECT
  USING (true);

-- ─── patreon_connections ─────────────────────────────────────────────────────
-- Each user manages their own Patreon connection row.
ALTER TABLE public.patreon_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patreon_connections_select_own" ON public.patreon_connections;
CREATE POLICY "patreon_connections_select_own"
  ON public.patreon_connections FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "patreon_connections_insert_own" ON public.patreon_connections;
CREATE POLICY "patreon_connections_insert_own"
  ON public.patreon_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "patreon_connections_update_own" ON public.patreon_connections;
CREATE POLICY "patreon_connections_update_own"
  ON public.patreon_connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "patreon_connections_delete_own" ON public.patreon_connections;
CREATE POLICY "patreon_connections_delete_own"
  ON public.patreon_connections FOR DELETE
  USING (auth.uid() = user_id);
