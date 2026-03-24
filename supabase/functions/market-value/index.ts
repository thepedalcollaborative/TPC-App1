import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REVERB_TOKEN = Deno.env.get('REVERB_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const REVERB_HEADERS = {
  'Accept': 'application/hal+json',
  'Accept-Version': '3.0',
  'Authorization': `Bearer ${REVERB_TOKEN}`,
};

// How old cached data can be before we re-fetch (24 hours)
const CACHE_TTL_HOURS = 24;

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { pedal_id, brand, model } = await req.json() as {
      pedal_id: string;
      brand: string;
      model: string;
    };

    if (!pedal_id || !brand || !model) {
      return new Response(JSON.stringify({ error: 'pedal_id, brand, model required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Check cache freshness
    const { data: cached } = await supabase
      .from('pedal_market_data')
      .select('*')
      .eq('pedal_id', pedal_id)
      .single();

    if (cached?.updated_at) {
      const ageHours = (Date.now() - new Date(cached.updated_at).getTime()) / 3_600_000;
      if (ageHours < CACHE_TTL_HOURS) {
        return new Response(JSON.stringify(cached), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const query = `${brand} ${model}`;

    // ── 1. Current used listings ──────────────────────────────────────────────
    const listingsRes = await fetch(
      `https://api.reverb.com/api/listings?` +
        new URLSearchParams({
          query,
          condition: 'used',
          per_page: '20',
          sort: 'price_asc',
        }),
      { headers: REVERB_HEADERS }
    );
    const listingsData = await listingsRes.json();
    const listings: number[] = (listingsData?.listings ?? [])
      .map((l: { price?: { amount?: string } }) => parseFloat(l.price?.amount ?? '0'))
      .filter((p: number) => p > 0);

    // ── 2. Sold used listings (last 30 days) ─────────────────────────────────
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString().split('T')[0];
    const soldRes = await fetch(
      `https://api.reverb.com/api/listings?` +
        new URLSearchParams({
          query,
          condition: 'used',
          state: 'sold',
          sold_listing_at_gte: thirtyDaysAgo,
          per_page: '20',
        }),
      { headers: REVERB_HEADERS }
    );
    const soldData = await soldRes.json();
    const sold: number[] = (soldData?.listings ?? [])
      .map((l: { price?: { amount?: string } }) => parseFloat(l.price?.amount ?? '0'))
      .filter((p: number) => p > 0);

    // ── 3. Compute averages ──────────────────────────────────────────────────
    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const avgList = avg(listings);
    const avgSold = avg(sold);

    // Weighted blend: 60% sold (more accurate), 40% listed
    // Fall back to whichever is available
    let marketValue: number | null = null;
    if (avgSold !== null && avgList !== null) {
      marketValue = avgSold * 0.6 + avgList * 0.4;
    } else if (avgSold !== null) {
      marketValue = avgSold;
    } else if (avgList !== null) {
      marketValue = avgList;
    }

    const row = {
      pedal_id,
      avg_used_list: avgList ? Math.round(avgList) : null,
      avg_used_sold: avgSold ? Math.round(avgSold) : null,
      market_value: marketValue ? Math.round(marketValue) : null,
      sample_count: listings.length + sold.length,
      updated_at: new Date().toISOString(),
    };

    await supabase.from('pedal_market_data').upsert(row, { onConflict: 'pedal_id' });

    return new Response(JSON.stringify(row), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
