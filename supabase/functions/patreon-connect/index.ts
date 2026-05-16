/**
 * patreon-connect — server-side Patreon OAuth token exchange + tier verification.
 *
 * Called by the mobile app after the user completes the Patreon OAuth flow.
 * Keeps PATREON_CLIENT_SECRET off the device.
 *
 * What it does:
 *   1. Receives { code, redirectUri } from the authenticated app user
 *   2. Exchanges the code for a Patreon access token
 *   3. Fetches the user's Patreon identity + active memberships
 *   4. Checks if they're an active patron on a qualifying tier
 *   5. Stores the connection in `patreon_connections` for future re-verification
 *   6. Updates `user_profiles` → is_premium = true, pro_source = 'patreon'
 *   7. Returns { isPro, tier }
 *
 * Required Supabase secrets:
 *   PATREON_CLIENT_ID      — from Patreon developer portal
 *   PATREON_CLIENT_SECRET  — from Patreon developer portal
 *   PATREON_PRO_TIER_IDS   — comma-separated tier IDs that grant Pro (leave empty = any active patron)
 *   SUPABASE_URL           — auto-set by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase
 *
 * Deploy:
 *   npx supabase functions deploy patreon-connect --no-verify-jwt
 *
 * Required Supabase table (run once in SQL editor):
 *   CREATE TABLE IF NOT EXISTS patreon_connections (
 *     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *     patreon_user_id text NOT NULL,
 *     access_token    text NOT NULL,
 *     refresh_token   text NOT NULL,
 *     tier_id         text,
 *     tier_name       text,
 *     is_active       boolean NOT NULL DEFAULT true,
 *     connected_at    timestamptz NOT NULL DEFAULT now(),
 *     verified_at     timestamptz NOT NULL DEFAULT now(),
 *     UNIQUE(user_id),
 *     UNIQUE(patreon_user_id)
 *   );
 *   ALTER TABLE patreon_connections ENABLE ROW LEVEL SECURITY;
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PATREON_CLIENT_ID     = Deno.env.get('PATREON_CLIENT_ID') ?? '';
const PATREON_CLIENT_SECRET = Deno.env.get('PATREON_CLIENT_SECRET') ?? '';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TOKEN_ENCRYPTION_KEY  = Deno.env.get('PATREON_TOKEN_ENCRYPTION_KEY') ?? '';

// Comma-separated Patreon tier IDs that grant Pro. Empty = any active patron qualifies.
const PRO_TIER_IDS = (Deno.env.get('PATREON_PRO_TIER_IDS') ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ── Token encryption (AES-GCM 256-bit) ───────────────────────────────────────
// Tokens are encrypted before being stored so a DB breach doesn't expose live
// Patreon credentials. The encryption key is stored in Supabase secrets, never
// in source code.

async function getEncryptionKey(): Promise<CryptoKey> {
  if (!TOKEN_ENCRYPTION_KEY) throw new Error('PATREON_TOKEN_ENCRYPTION_KEY secret not set');
  const keyBytes = Uint8Array.from(atob(TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
}

async function encryptToken(token: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token),
  );
  // Store as base64(IV + ciphertext) so we can recover the IV at decrypt time
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // ── Auth: get caller's Supabase user ID from the Bearer JWT ──────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing authorization header' }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: { user }, error: userErr } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );

  if (userErr || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ── Parse request body ────────────────────────────────────────────────────
  let code: string, redirectUri: string;
  try {
    const body = await req.json();
    code        = body.code;
    redirectUri = body.redirectUri;
    if (!code || !redirectUri) throw new Error('Missing fields');
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  // ── Step 1: Exchange code for Patreon access token ────────────────────────
  const tokenRes = await fetch('https://www.patreon.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type:    'authorization_code',
      client_id:     PATREON_CLIENT_ID,
      client_secret: PATREON_CLIENT_SECRET,
      redirect_uri:  redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('[patreon-connect] Token exchange failed:', body);
    return json({ error: 'Patreon token exchange failed' }, 502);
  }

  const tokenData = await tokenRes.json() as {
    access_token:  string;
    refresh_token: string;
    expires_in:    number;
  };

  const { access_token, refresh_token } = tokenData;

  // ── Step 2: Fetch Patreon identity + memberships ──────────────────────────
  const identityUrl = new URL('https://www.patreon.com/api/oauth2/v2/identity');
  identityUrl.searchParams.set(
    'include',
    'memberships.currently_entitled_tiers',
  );
  identityUrl.searchParams.set('fields[user]',   'email,full_name');
  identityUrl.searchParams.set('fields[member]',  'patron_status,currently_entitled_amount_cents');
  identityUrl.searchParams.set('fields[tier]',    'title,amount_cents');

  const identityRes = await fetch(identityUrl.toString(), {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!identityRes.ok) {
    console.error('[patreon-connect] Identity fetch failed:', await identityRes.text());
    return json({ error: 'Failed to fetch Patreon identity' }, 502);
  }

  const identity = await identityRes.json() as {
    data: {
      id: string;
      relationships?: {
        memberships?: {
          data: { id: string; type: string }[];
        };
      };
    };
    included?: {
      id:         string;
      type:       string;
      attributes: Record<string, unknown>;
    }[];
  };

  const patreonUserId = identity.data.id;

  // ── Step 3: Check membership tier ─────────────────────────────────────────
  const memberships = (identity.included ?? []).filter(i => i.type === 'member');
  const tiers       = (identity.included ?? []).filter(i => i.type === 'tier');

  let isPro      = false;
  let tierName: string | null = null;
  let tierId:   string | null = null;

  for (const m of memberships) {
    const attrs = m.attributes as {
      patron_status?: string;
      currently_entitled_amount_cents?: number;
    };

    if (attrs.patron_status !== 'active_patron') continue;

    if (PRO_TIER_IDS.length === 0) {
      // Any active patron qualifies
      isPro = true;
      break;
    }

    // Check if any entitled tier is in our pro list
    const entitledTierIds: string[] = (identity.data.relationships?.memberships?.data ?? [])
      .map(d => d.id);

    for (const t of tiers) {
      if (entitledTierIds.includes(t.id) && PRO_TIER_IDS.includes(t.id)) {
        isPro    = true;
        tierId   = t.id;
        tierName = (t.attributes.title as string) ?? null;
        break;
      }
    }

    if (isPro) break;
  }

  // ── Step 4: Upsert patreon_connections row ────────────────────────────────
  // Tokens are encrypted with AES-GCM before storage so a DB breach can't
  // expose live Patreon credentials.
  let storedAccessToken  = '';
  let storedRefreshToken = '';
  let isEncrypted = false;
  try {
    storedAccessToken  = await encryptToken(access_token);
    storedRefreshToken = await encryptToken(refresh_token);
    isEncrypted = true;
  } catch (encErr) {
    console.error('[patreon-connect] Token encryption failed:', (encErr as Error).message);
    // Fail closed — do not store plaintext tokens
    return json({ error: 'Token encryption unavailable. Please try again later.' }, 500);
  }

  const { error: upsertErr } = await supabase
    .from('patreon_connections')
    .upsert(
      {
        user_id:         user.id,
        patreon_user_id: patreonUserId,
        access_token:    storedAccessToken,
        refresh_token:   storedRefreshToken,
        encrypted:       isEncrypted,
        tier_id:         tierId,
        tier_name:       tierName,
        is_active:       isPro,
        verified_at:     new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (upsertErr) {
    // Non-fatal — log and continue; profile update is the critical step
    console.error('[patreon-connect] patreon_connections upsert error:', upsertErr.message);
  }

  // ── Step 5: Update user_profiles ─────────────────────────────────────────
  // Only PROMOTE to Pro — never demote. A user who connected Patreon but isn't
  // an active patron at the right tier simply gets the connection recorded;
  // their existing is_premium (manually set or from another source) is preserved.
  // Revocation must be an explicit admin action, not a side-effect of OAuth reconnect.
  if (isPro) {
    const { error: profileErr } = await supabase
      .from('user_profiles')
      .update({ is_premium: true, pro_source: 'patreon' })
      .eq('id', user.id);

    if (profileErr) {
      console.error('[patreon-connect] user_profiles update error:', profileErr.message);
      return json({ error: 'Failed to update profile' }, 500);
    }
  }

  return json({ isPro, tier: tierName });
});
