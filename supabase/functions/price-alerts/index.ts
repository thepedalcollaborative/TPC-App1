/**
 * price-alerts — Supabase Edge Function
 *
 * Checks all wishlist items that have a target_price set against live Reverb
 * listings, then sends an Expo push notification to the user if any listing
 * falls at or below their target.
 *
 * Designed to be triggered on a cron schedule (e.g. every 6 hours).
 * Set up in Supabase dashboard → Edge Functions → Schedules, or via pg_cron:
 *
 *   select cron.schedule(
 *     'price-alerts',
 *     '0 * /6 * * *',   -- every 6 hours
 *     $$
 *       select net.http_post(
 *         url := current_setting('app.supabase_url') || '/functions/v1/price-alerts',
 *         headers := jsonb_build_object(
 *           'Authorization', 'Bearer ' || current_setting('app.service_key'),
 *           'Content-Type', 'application/json'
 *         ),
 *         body := '{}'::jsonb
 *       );
 *     $$
 *   );
 *
 * Or, simpler: use the Supabase Dashboard → Edge Functions → add a Cron trigger.
 *
 * Required env vars (set in Supabase Dashboard → Settings → Edge Functions):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   REVERB_TOKEN
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SRV_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const REVERB_TOKEN      = Deno.env.get('REVERB_TOKEN') ?? '';

// How long to wait before re-alerting for the same item (24 h)
const ALERT_COOLDOWN_H  = 24;

const REVERB_HEADERS = {
  'Accept':         'application/hal+json',
  'Accept-Version': '3.0',
  'Authorization':  `Bearer ${REVERB_TOKEN}`,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type WishlistItem = {
  id: string;
  user_id: string;
  target_price: number;
  price_alert_sent_at: string | null;
  pedal: { brand: string; model: string } | null;
};

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  badge?: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// AWIN affiliate wrapping — must match src/lib/reverb.ts in the app
const AWIN_MID   = '67144';
const AWIN_AFFID = '1515586';
function awinUrl(reverbUrl: string): string {
  return `https://www.awin1.com/cread.php?awinmid=${AWIN_MID}&awinaffid=${AWIN_AFFID}&ued=${encodeURIComponent(reverbUrl)}`;
}

type LowestListing = { price: number; url: string | null };

/** Search Reverb for listings of a pedal and return the lowest-priced one. */
async function lowestReverbListing(brand: string, model: string): Promise<LowestListing | null> {
  try {
    const query  = encodeURIComponent(`${brand} ${model}`);
    const url    = `https://api.reverb.com/api/listings?query=${query}&condition=all&per_page=10&sort=price_asc`;
    const res    = await fetch(url, { headers: REVERB_HEADERS });
    if (!res.ok) return null;
    const json   = await res.json();
    const listings = (json?.listings ?? []) as Array<{
      price?: { amount?: string };
      _links?: { web?: { href?: string } };
    }>;
    let best: LowestListing | null = null;
    for (const l of listings) {
      const price = parseFloat(l?.price?.amount ?? '');
      if (isNaN(price) || price <= 0) continue;
      if (!best || price < best.price) {
        best = { price, url: l?._links?.web?.href ?? null };
      }
    }
    return best;
  } catch {
    return null;
  }
}

/** Send a batch of Expo push notifications. */
async function sendExpoPushMessages(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  // Expo push API accepts up to 100 messages per request
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(batch),
    });
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SRV_KEY);

    // Fetch all wishlist items with a target price, plus their push token
    const cooldownCutoff = new Date(Date.now() - ALERT_COOLDOWN_H * 60 * 60 * 1000).toISOString();
    // No FK between user_pedals.user_id and user_profiles (it references
    // auth.users), so PostgREST can't embed the profile — fetch push tokens
    // in a second query instead.
    const { data, error } = await supabase
      .from('user_pedals')
      .select(`
        id,
        user_id,
        target_price,
        price_alert_sent_at,
        pedal:pedals ( brand, model )
      `)
      .eq('status', 'wishlist')
      .not('target_price', 'is', null)
      .or(`price_alert_sent_at.is.null,price_alert_sent_at.lt.${cooldownCutoff}`);

    if (error) throw error;

    const items = (data ?? []) as WishlistItem[];

    const userIds = [...new Set(items.map(i => i.user_id))];
    const pushTokens = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles, error: profErr } = await supabase
        .from('user_profiles')
        .select('id, push_token')
        .in('id', userIds)
        .not('push_token', 'is', null);
      if (profErr) throw profErr;
      for (const p of (profiles ?? []) as Array<{ id: string; push_token: string | null }>) {
        if (p.push_token) pushTokens.set(p.id, p.push_token);
      }
    }
    if (items.length === 0) {
      return new Response(JSON.stringify({ checked: 0, alerts: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pushMessages: ExpoPushMessage[] = [];
    const alertedIds: string[] = [];

    for (const item of items) {
      const pushToken = pushTokens.get(item.user_id);
      if (!pushToken || !pushToken.startsWith('ExponentPushToken')) continue;
      if (!item.pedal?.brand || !item.pedal?.model) continue;

      const lowest = await lowestReverbListing(item.pedal.brand, item.pedal.model);
      if (lowest === null || lowest.price > item.target_price) continue;

      // Price is at or below target — queue a notification.
      // `url` is the AWIN-wrapped direct listing link; tapping the notification
      // opens it (see notification response handler in App.tsx). Falls back to
      // an AWIN-wrapped search when the listing URL is missing.
      const buyUrl = lowest.url
        ? awinUrl(lowest.url)
        : awinUrl(`https://reverb.com/marketplace?query=${encodeURIComponent(`${item.pedal.brand} ${item.pedal.model}`)}`);
      pushMessages.push({
        to:    pushToken,
        sound: 'default',
        title: `Price drop: ${item.pedal.brand} ${item.pedal.model} 🎯`,
        body:  `Listed at $${Math.round(lowest.price)} on Reverb — your target is $${Math.round(item.target_price)}. Tap to view.`,
        data:  { screen: 'Vault', tab: 'wishlist', pedalId: item.id, url: buyUrl },
      });
      alertedIds.push(item.id);
    }

    // Fire notifications
    await sendExpoPushMessages(pushMessages);

    // Mark alerted items so we don't spam (cooldown)
    if (alertedIds.length > 0) {
      await supabase
        .from('user_pedals')
        .update({ price_alert_sent_at: new Date().toISOString() })
        .in('id', alertedIds);
    }

    return new Response(
      JSON.stringify({ checked: items.length, alerts: alertedIds.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const detail = err instanceof Error
      ? err.message
      : JSON.stringify(err); // Supabase query errors are plain objects
    return new Response(
      JSON.stringify({ error: detail }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
