import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REVERB_TOKEN      = Deno.env.get('REVERB_TOKEN') ?? '';
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const REVERB_HEADERS = {
  'Accept': 'application/hal+json',
  'Accept-Version': '3.0',
  'Authorization': `Bearer ${REVERB_TOKEN}`,
};

const CACHE_TTL_HOURS = 24;

// Maps our condition values to the slugs Reverb returns on listing objects
const CONDITION_SLUG_MAP: Record<string, string[]> = {
  'Excellent':       ['mint', 'excellent'],
  'Very Good':       ['very-good'],
  'Good':            ['good'],
  'Fair':            ['fair'],
  'Poor':            ['poor'],
  'Non Functioning': ['non-functioning'],
  'Brand New':       ['brand-new', 'b-stock'],
};

type ReverbListing = {
  price?: { amount?: string };
  condition?: { slug?: string };
  title?: string;
};

// Median: robust to outliers — a single $1 parts listing or $999 collector
// listing doesn't move the number.
const medianOf = (arr: number[]): number | null => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid JWT' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { pedal_id, brand, model, condition } = await req.json() as {
      pedal_id: string;
      brand: string;
      model: string;
      condition?: string;
    };

    if (!pedal_id || !brand || !model) {
      return new Response(JSON.stringify({ error: 'pedal_id, brand, model required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize condition to a stable cache key
    const conditionKey = condition ?? 'used';
    const conditionSlugs = condition ? (CONDITION_SLUG_MAP[condition] ?? null) : null;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Check cache — keyed by (pedal_id, condition)
    const { data: cached } = await supabase
      .from('pedal_market_data')
      .select('*')
      .eq('pedal_id', pedal_id)
      .eq('condition', conditionKey)
      .maybeSingle();

    if (cached?.updated_at) {
      const ageHours = (Date.now() - new Date(cached.updated_at).getTime()) / 3_600_000;
      if (ageHours < CACHE_TTL_HOURS) {
        return new Response(JSON.stringify(cached), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const query = `${brand} ${model}`;

    // Always fetch a wide sample — we filter for relevance and use the median,
    // so more data only helps.
    const perPage = '50';

    // Filter helper — only applied when the user has set a condition
    const matchesCondition = (listing: ReverbListing): boolean => {
      if (!conditionSlugs) return true;
      const slug = listing.condition?.slug ?? '';
      return conditionSlugs.some(s => slug === s || slug.startsWith(s));
    };

    // Relevance: every significant token of the model name must appear in the
    // listing title, or the listing is ignored (kills bundles, parts, boxes,
    // and adjacent models that a bare text query pulls in).
    const modelTokens = model
      .toLowerCase()
      .split(/[\s/-]+/)
      .filter(t => t.length > 1);
    const isRelevant = (listing: ReverbListing): boolean => {
      const title = (listing.title ?? '').toLowerCase();
      if (!title) return true; // no title returned — don't discard
      return modelTokens.every(t => title.includes(t));
    };

    const extractPrices = (listings: ReverbListing[]): number[] =>
      listings
        .filter(isRelevant)
        .filter(matchesCondition)
        .map(l => parseFloat(l.price?.amount ?? '0'))
        .filter(p => p > 0);

    // ── 1. Current used listings ──────────────────────────────────────────────
    // NOTE: no price sort — sorting ascending and averaging the first page
    // meant "average of the 50 cheapest", which biased every value low.
    const listingsRes = await fetch(
      `https://api.reverb.com/api/listings?` +
        new URLSearchParams({
          query,
          condition: 'used',
          per_page: perPage,
        }),
      { headers: REVERB_HEADERS }
    );
    const listingsData = await listingsRes.json();
    const listings = extractPrices((listingsData?.listings ?? []) as ReverbListing[]);

    // ── 2. Sold used listings (last 30 days) ─────────────────────────────────
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString().split('T')[0];
    const soldRes = await fetch(
      `https://api.reverb.com/api/listings?` +
        new URLSearchParams({
          query,
          condition: 'used',
          state: 'sold',
          sold_listing_at_gte: thirtyDaysAgo,
          per_page: perPage,
        }),
      { headers: REVERB_HEADERS }
    );
    const soldData = await soldRes.json();
    const sold = extractPrices((soldData?.listings ?? []) as ReverbListing[]);

    // ── 3. Reverb Price Guide (their own transaction-based estimate) ─────────
    let guideValue: number | null = null;
    try {
      const guideRes = await fetch(
        `https://api.reverb.com/api/priceguide?` +
          new URLSearchParams({ query, per_page: '5' }),
        { headers: REVERB_HEADERS }
      );
      if (guideRes.ok) {
        const guideData = await guideRes.json();
        const entries = (guideData?.price_guides ?? []) as Array<{
          title?: string;
          estimated_value?: { price_low?: { amount?: string }; price_high?: { amount?: string } };
          price_low?: { amount?: string };
          price_high?: { amount?: string };
        }>;
        // Take the first entry whose title matches the model
        const entry = entries.find(e => {
          const title = (e.title ?? '').toLowerCase();
          return modelTokens.every(t => title.includes(t));
        });
        if (entry) {
          const low = parseFloat(
            entry.estimated_value?.price_low?.amount ?? entry.price_low?.amount ?? ''
          );
          const high = parseFloat(
            entry.estimated_value?.price_high?.amount ?? entry.price_high?.amount ?? ''
          );
          if (low > 0 && high > 0) guideValue = (low + high) / 2;
          else if (low > 0) guideValue = low;
        }
      }
    } catch {
      // Price guide is a bonus signal — never fail the request over it
    }

    // ── 4. TPC in-app sales (real transactions from our own users) ───────────
    // The retire flow already captures retired_price when a pedal is sold.
    let tpcSalesValue: number | null = null;
    let tpcSalesCount = 0;
    try {
      const { data: sales } = await supabase
        .from('user_pedals')
        .select('retired_price, condition')
        .eq('pedal_id', pedal_id)
        .eq('status', 'retired')
        .eq('retired_method', 'sale')
        .not('retired_price', 'is', null)
        .gt('retired_price', 0);
      if (sales && sales.length > 0) {
        // Prefer sales matching the requested condition when there are enough
        const rows = sales as Array<{ retired_price: number; condition: string | null }>;
        const conditionMatched = condition
          ? rows.filter(s => s.condition === condition)
          : rows;
        const usable = conditionMatched.length >= 2 ? conditionMatched : rows;
        const prices = usable.map(s => s.retired_price);
        tpcSalesCount = prices.length;
        tpcSalesValue = medianOf(prices);
      }
    } catch {
      // Same: bonus signal only
    }

    // ── 5. Confidence-weighted blend ──────────────────────────────────────────
    // Each source contributes its median weighted by (per-point weight × count,
    // count capped so no single source swamps the rest).
    //   TPC sales    1.5/pt — true transactions with known condition, our data
    //   Reverb sold  1.0/pt — real transactions
    //   Price Guide  fixed 10 — Reverb's own aggregate estimate
    //   Asking       0.5/pt — asking prices run high
    const medList = medianOf(listings);
    const medSold = medianOf(sold);
    const CAP = 25;
    const sources: Array<{ value: number; weight: number }> = [];
    if (tpcSalesValue !== null) sources.push({ value: tpcSalesValue, weight: 1.5 * Math.min(tpcSalesCount, CAP) });
    if (medSold !== null)       sources.push({ value: medSold, weight: 1.0 * Math.min(sold.length, CAP) });
    if (guideValue !== null)    sources.push({ value: guideValue, weight: 10 });
    if (medList !== null)       sources.push({ value: medList, weight: 0.5 * Math.min(listings.length, CAP) });

    const totalWeight = sources.reduce((s, x) => s + x.weight, 0);
    const marketValue = totalWeight > 0
      ? sources.reduce((s, x) => s + x.value * x.weight, 0) / totalWeight
      : null;

    const row = {
      pedal_id,
      condition: conditionKey,
      avg_used_list: medList ? Math.round(medList) : null,
      avg_used_sold: medSold ? Math.round(medSold) : null,
      guide_value: guideValue ? Math.round(guideValue) : null,
      tpc_sales_value: tpcSalesValue ? Math.round(tpcSalesValue) : null,
      tpc_sales_count: tpcSalesCount,
      market_value: marketValue ? Math.round(marketValue) : null,
      sample_count: listings.length + sold.length + tpcSalesCount,
      updated_at: new Date().toISOString(),
    };

    await supabase
      .from('pedal_market_data')
      .upsert(row, { onConflict: 'pedal_id,condition' });

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
