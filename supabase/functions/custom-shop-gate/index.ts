/**
 * custom-shop-gate
 *
 * Server-side gate for Custom Shop runs.
 * Atomically checks and consumes the free-tier lifetime run via Postgres RPC.
 * Pro users are always allowed (checked server-side against is_premium).
 *
 * Response shapes:
 *   200 { allowed: true,  isFirstRun: boolean, runsUsed: number }
 *   402 { allowed: false, error: "limit_reached" }
 *   401 { allowed: false, error: "unauthorized" }
 *   500 { allowed: false, error: "internal_error" }
 *
 * Deploy: npx supabase functions deploy custom-shop-gate
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ allowed: false, error: 'unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );
  if (authError || !user) return json({ allowed: false, error: 'unauthorized' }, 401);

  const { data, error } = await supabase.rpc('consume_custom_shop_run', {
    p_user_id: user.id,
  });

  if (error) {
    console.error('[custom-shop-gate] RPC error:', error.message);
    return json({ allowed: false, error: 'internal_error' }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json({ allowed: false, error: 'internal_error' }, 500);

  if (!row.allowed) {
    if (row.error === 'limit_reached') {
      return json({ allowed: false, error: 'limit_reached' }, 402);
    }
    return json({ allowed: false, error: row.error ?? 'unauthorized' }, 401);
  }

  // Issue a single-run ticket — tpc-advisor requires it for custom_shop calls
  // (analysis + interview questions + final pick + retries; 8 calls / 20 min).
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: ticket, error: ticketErr } = await admin.rpc('create_custom_shop_ticket', {
    p_user_id: user.id,
  });
  if (ticketErr || !ticket) {
    console.error('[custom-shop-gate] ticket error:', ticketErr?.message);
    return json({ allowed: false, error: 'internal_error' }, 500);
  }

  return json({
    allowed:    true,
    isFirstRun: row.runs_used === 1,
    runsUsed:   row.runs_used,
    ticket,
  });
});
