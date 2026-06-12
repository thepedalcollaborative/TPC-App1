// auth-login — rate-limited email/password sign-in proxy.
//
// Wraps Supabase's /auth/v1/token endpoint with a per-email server-side
// rate limit: 5 failed attempts per 15-minute window triggers a 429.
// The client-side lockout in AuthScreen is a fast first-pass only;
// this is the authoritative, restart-proof guard.
//
// The function is intentionally unauthenticated — the caller is signing in.
//
// Deploy: npx supabase functions deploy auth-login

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ── 1. Parse body ─────────────────────────────────────────────────────────
  let email: string, password: string;
  try {
    ({ email, password } = await req.json());
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return json({ error: 'email and password are required' }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // ── 2. Check server-side rate limit ──────────────────────────────────────
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: allowed, error: rlErr } = await admin.rpc('check_login_rate_limit', {
    p_email:          normalizedEmail,
    p_window_seconds: 900,  // 15 minutes
    p_max_failures:   5,
  });

  if (rlErr) {
    console.error('[auth-login] rate limit check error:', rlErr.message);
    // Fail open — don't lock users out due to a DB error, but log it.
  }

  if (!rlErr && allowed === false) {
    return json({
      error: 'Too many failed login attempts. Please wait 15 minutes before trying again.',
    }, 429);
  }

  // ── 3. Proxy to Supabase Auth ─────────────────────────────────────────────
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey':       SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: normalizedEmail, password }),
  });

  const authBody = await authRes.json();
  const succeeded = authRes.ok && !!authBody.access_token;

  // ── 4. Record the attempt (fire-and-forget — don't block the response) ───
  admin.rpc('record_login_attempt', {
    p_email:   normalizedEmail,
    p_success: succeeded,
  }).catch((e: unknown) => console.error('[auth-login] record attempt error:', e));

  // ── 5. Return the auth response verbatim ─────────────────────────────────
  return json(authBody, authRes.status);
});
