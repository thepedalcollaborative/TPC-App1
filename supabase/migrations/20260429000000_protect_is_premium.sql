-- Prevent client-side writes to is_premium via the anon/authenticated role.
--
-- Background: until RevenueCat webhooks are wired up, is_premium is set
-- manually in the dashboard. The client-side subscription.ts functions were
-- calling `update({ is_premium: false })` whenever RevenueCat returned empty
-- entitlements (e.g. RC not configured, or user tapped Restore with no sub),
-- silently demoting manually-promoted Pro users.
--
-- Fix (code layer): subscription.ts now only ever writes `is_premium: true`.
-- Fix (DB layer):   revoke UPDATE privilege on is_premium from the client roles
--                   so even buggy client code cannot demote a Pro user.
--                   Only service_role (webhooks, edge functions, admin scripts)
--                   can change is_premium.
--
-- When RevenueCat webhooks are live, the webhook edge function runs as
-- service_role and can freely update is_premium in both directions.

-- Remove UPDATE permission on the is_premium column from the authenticated role.
-- authenticated = any logged-in Supabase user via the anon/JWT key.
REVOKE UPDATE (is_premium) ON TABLE public.user_profiles FROM authenticated;

-- anon role (unauthenticated requests) should never touch it either.
REVOKE UPDATE (is_premium) ON TABLE public.user_profiles FROM anon;

-- Note: service_role retains full access (it bypasses RLS entirely).
-- The existing user_profiles_update_own RLS policy still governs all other
-- columns (username, display_name, push_token, etc.) as before.
