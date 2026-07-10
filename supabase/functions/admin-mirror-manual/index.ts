/**
 * admin-mirror-manual — Supabase Edge Function
 *
 * Downloads a manual PDF from an admin-supplied URL and mirrors it
 * permanently into the 'pedal-manuals' Supabase Storage bucket, so the app
 * never depends on the manufacturer's link staying alive.
 *
 * Body: { pedal_id: string, manual_url: string }
 * Returns: { manual_url: string, manual_storage_path: string | null }
 *
 * Required env vars (Supabase Edge Function secrets):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { pedal_id, manual_url } = await req.json().catch(() => ({})) as {
    pedal_id?: string;
    manual_url?: string;
  };
  if (!pedal_id || !manual_url) {
    return new Response(JSON.stringify({ error: 'pedal_id and manual_url required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let manualStoragePath: string | null = null;
  let finalUrl = manual_url;

  try {
    const res = await fetch(manual_url, { signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? 'application/pdf';
      const buffer = await res.arrayBuffer();
      const path = `${pedal_id}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('pedal-manuals')
        .upload(path, buffer, { contentType, upsert: true });

      if (!uploadError) {
        manualStoragePath = path;
        const { data: { publicUrl } } = supabase.storage
          .from('pedal-manuals')
          .getPublicUrl(path);
        finalUrl = publicUrl;
      }
    }
  } catch {
    // Mirroring failed — fall back to the original URL so the field is at
    // least populated; admin can retry later.
  }

  await supabase
    .from('pedals')
    .update({ manual_url: finalUrl, manual_storage_path: manualStoragePath })
    .eq('id', pedal_id);

  return new Response(
    JSON.stringify({ manual_url: finalUrl, manual_storage_path: manualStoragePath }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
