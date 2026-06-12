// delete-account — permanently deletes the calling user's account and all data.
//
// Because deleting from auth.users requires admin privileges, this function
// runs with the service-role key. The calling user must be authenticated —
// we verify their JWT before doing anything destructive.
//
// Cascade chain (most data is handled automatically):
//   auth.users → user_profiles (ON DELETE CASCADE)
//     user_profiles → weekly_picks (ON DELETE CASCADE)
//     user_profiles → boards (ON DELETE CASCADE, if set)
//   auth.users → user_pedals (ON DELETE CASCADE, if set)
//   auth.users → advisor_memory (ON DELETE CASCADE)
//
// We explicitly delete user_pedals, boards, board_slots, advisor_memory,
// patreon_connections, recommendation_feedback before deleting the auth user
// to ensure nothing lingers in tables that may lack a cascade constraint.
//
// Deploy: npx supabase functions deploy delete-account

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting is handled via the persistent check_rate_limit() RPC in Postgres.
// This survives cold starts and concurrent invocations unlike an in-memory Map.

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. Verify the caller is authenticated ─────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // User-scoped client — confirms the JWT is valid
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    // ── 2. Service-role client for privileged deletes ─────────────────────────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Rate limit check (persistent — survives cold starts) ──────────────────
    // Limit: 1 delete attempt per 60-second window per user.
    const { data: allowed, error: rlErr } = await admin.rpc('check_rate_limit', {
      p_user_id:        userId,
      p_endpoint:       'delete-account',
      p_limit:          1,
      p_window_seconds: 60,
    });
    if (rlErr) {
      console.error('[delete-account] rate limit check error:', rlErr.message);
    } else if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please wait before trying again.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 3. Explicitly delete user data ────────────────────────────────────────
    // Order matters: delete child rows before parent rows.

    // board_slots (child of boards)
    const { data: userBoards } = await admin
      .from('boards')
      .select('id')
      .eq('user_id', userId);

    if (userBoards && userBoards.length > 0) {
      const boardIds = userBoards.map((b: { id: string }) => b.id);
      await admin.from('board_slots').delete().in('board_id', boardIds);
    }

    // User-owned tables
    await admin.from('boards').delete().eq('user_id', userId);
    await admin.from('user_pedals').delete().eq('user_id', userId);
    await admin.from('advisor_memory').delete().eq('user_id', userId);
    await admin.from('weekly_picks').delete().eq('user_id', userId);
    await admin.from('recommendation_feedback').delete().eq('user_id', userId);
    await admin.from('patreon_connections').delete().eq('user_id', userId);

    // Storage: delete ALL of the user's pedal photos.
    //
    // Photos are stored nested at `${userId}/pedals/${pedalId}/${ts}.jpg`, so a
    // single `.list(userId)` only returns the `pedals` folder *prefix* — not the
    // actual files. Supabase Storage has no recursive delete, so we walk the
    // tree: list folders, recurse into each, and collect every real object key
    // (entries with a non-null `id`). Without this, a user who deletes their
    // account leaves their photos in storage indefinitely (right-to-erasure bug).
    const collectFileKeys = async (prefix: string): Promise<string[]> => {
      const keys: string[] = [];
      const { data: entries } = await admin.storage
        .from('user-pedal-photos')
        .list(prefix, { limit: 1000 });

      for (const entry of entries ?? []) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        // A null `id` means this is a folder/prefix, not a file → recurse.
        if ((entry as { id: string | null }).id === null) {
          keys.push(...await collectFileKeys(fullPath));
        } else {
          keys.push(fullPath);
        }
      }
      return keys;
    };

    try {
      const fileKeys = await collectFileKeys(userId);
      // remove() caps at 1000 keys per call — chunk to be safe.
      for (let i = 0; i < fileKeys.length; i += 1000) {
        const batch = fileKeys.slice(i, i + 1000);
        if (batch.length > 0) {
          await admin.storage.from('user-pedal-photos').remove(batch);
        }
      }
    } catch (storageErr) {
      // Non-fatal: log but continue with account deletion. We don't want a
      // storage hiccup to block the auth-user deletion the user requested.
      console.error('[delete-account] storage cleanup error:', storageErr);
    }

    // ── 4. Delete the auth user (cascades to user_profiles) ───────────────────
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error('[delete-account] auth.admin.deleteUser error:', deleteErr.message);
      return new Response(JSON.stringify({ error: 'Failed to delete account' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[delete-account] unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
