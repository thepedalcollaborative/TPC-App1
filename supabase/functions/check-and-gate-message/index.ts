/**
 * check-and-gate-message
 *
 * Atomically checks whether the authenticated user may send an AI advisor message,
 * then increments the appropriate counter if allowed.
 *
 * Response shapes:
 *   200 { allowed: true,  used: number, allotment: 50, credits: number }
 *   200 { allowed: true,  used_credit: true, credits: number }          ← used a top-up credit
 *   402 { allowed: false, error: "messages_depleted", credits: 0 }
 *   403 { allowed: false, error: "pro_required" }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOTMENT = 100; // Pro monthly message allotment

Deno.serve(async (req) => {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ allowed: false, error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader } },
    },
  );

  // Validate the user's JWT
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (authError || !user) {
    return json({ allowed: false, error: 'unauthorized' }, 401);
  }

  // Atomic consume via SECURITY DEFINER RPC to avoid race conditions
  const { data, error } = await supabase.rpc('consume_ai_message_quota', {
    p_user_id: user.id,
    p_allotment: ALLOTMENT,
  });

  if (error) {
    return json({ allowed: false, error: 'internal_error' }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return json({ allowed: false, error: 'internal_error' }, 500);
  }

  if (!row.allowed) {
    if (row.error === 'pro_required') return json({ allowed: false, error: 'pro_required' }, 403);
    if (row.error === 'messages_depleted') return json({ allowed: false, error: 'messages_depleted', credits: row.credits ?? 0 }, 402);
    if (row.error === 'profile_not_found') return json({ allowed: false, error: 'profile_not_found' }, 404);
    return json({ allowed: false, error: row.error ?? 'unauthorized' }, 401);
  }

  if (row.used_credit) {
    return json({
      allowed: true,
      used_credit: true,
      credits: row.credits ?? 0,
    });
  }

  return json({
    allowed: true,
    used: row.used ?? 0,
    allotment: row.allotment ?? ALLOTMENT,
    credits: row.credits ?? 0,
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
