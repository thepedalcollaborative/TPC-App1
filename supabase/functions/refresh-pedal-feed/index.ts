/**
 * refresh-pedal-feed
 *
 * Runs nightly (pg_cron at 3 AM UTC) to harvest recently-active pedals from
 * Reverb and upsert them into public.recent_pedals.
 *
 * Strategy:
 *   - Query Reverb for recent listings across several pedal category keywords
 *   - Group results by brand+model, count listings, average price
 *   - Keep entries with ≥2 listings (filters noise / one-offs)
 *   - Upsert into recent_pedals; stale rows (>90 days unseen) are pruned
 *
 * The tpc-advisor reads recent_pedals at query time and injects a compact
 * "recently trending / newly released" block into the system prompt.
 *
 * Deploy: npx supabase functions deploy refresh-pedal-feed --no-verify-jwt
 * Secrets: REVERB_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REVERB_TOKEN     = Deno.env.get('REVERB_TOKEN') ?? '';
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const REVERB_HEADERS = {
  Authorization:        `Bearer ${REVERB_TOKEN}`,
  'X-Display-Currency': 'USD',
  Accept:               'application/hal+json',
  'Accept-Version':     '3.0',
};

// Broad category search terms — each pulls 50 recently-listed items
const SEARCH_TERMS = [
  'overdrive pedal',
  'distortion pedal',
  'fuzz pedal',
  'delay pedal',
  'reverb pedal',
  'chorus pedal',
  'compressor pedal',
  'looper pedal',
  'boost pedal',
  'phaser pedal',
];

const MIN_LISTINGS = 2;
const PER_PAGE     = 50;

interface ReverbListing {
  make?:  string;
  model?: string;
  price?: { amount?: string };
  categories?: Array<{ full_name?: string }>;
}

interface Aggregated {
  brand:    string;
  model:    string;
  category: string | null;
  prices:   number[];
}

function slugId(brand: string, model: string): string {
  return `${brand}|${model}`.toLowerCase().replace(/\s+/g, '-');
}

function normalizeCategory(fullName: string | undefined): string | null {
  if (!fullName) return null;
  const lower = fullName.toLowerCase();
  if (lower.includes('overdrive') || lower.includes('distortion') || lower.includes('fuzz')) return 'drive';
  if (lower.includes('delay'))   return 'delay';
  if (lower.includes('reverb'))  return 'reverb';
  if (lower.includes('chorus') || lower.includes('flanger') || lower.includes('phaser')) return 'modulation';
  if (lower.includes('compressor')) return 'compressor';
  if (lower.includes('boost') || lower.includes('preamp')) return 'boost';
  if (lower.includes('looper') || lower.includes('loop')) return 'looper';
  if (lower.includes('wah') || lower.includes('filter')) return 'filter';
  if (lower.includes('pitch') || lower.includes('octave') || lower.includes('harmonizer')) return 'pitch';
  if (lower.includes('eq') || lower.includes('equalizer')) return 'eq';
  return null;
}

serve(async () => {
  if (!REVERB_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response('Missing env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const aggregated = new Map<string, Aggregated>();

  for (const term of SEARCH_TERMS) {
    const url = `https://api.reverb.com/api/listings?` + new URLSearchParams({
      query:     term,
      condition: 'all',
      per_page:  String(PER_PAGE),
      sort:      'created_at|desc',
    });

    try {
      const res = await fetch(url, { headers: REVERB_HEADERS });
      if (!res.ok) { console.warn(`Reverb ${res.status} for "${term}"`); continue; }
      const data = await res.json();
      const listings: ReverbListing[] = data.listings ?? [];

      for (const listing of listings) {
        const brand = (listing.make  ?? '').trim();
        const model = (listing.model ?? '').trim();
        if (!brand || !model || brand.length < 2 || model.length < 1) continue;

        const price = parseFloat(listing.price?.amount ?? '');
        const id    = slugId(brand, model);
        const cat   = normalizeCategory(listing.categories?.[0]?.full_name);

        const existing = aggregated.get(id);
        if (existing) {
          if (!isNaN(price)) existing.prices.push(price);
          // keep existing category if already set
          if (!existing.category && cat) existing.category = cat;
        } else {
          aggregated.set(id, {
            brand,
            model,
            category: cat,
            prices:   isNaN(price) ? [] : [price],
          });
        }
      }
    } catch (err) {
      console.error(`Reverb fetch error for "${term}":`, err);
    }
  }

  // Filter to entries seen in ≥2 listings and build upsert rows
  const now  = new Date().toISOString();
  const rows = Array.from(aggregated.entries())
    .filter(([, v]) => v.prices.length >= MIN_LISTINGS)
    .map(([id, v]) => ({
      id,
      brand:         v.brand,
      model:         v.model,
      category:      v.category,
      avg_price:     v.prices.length > 0
        ? Math.round(v.prices.reduce((a, b) => a + b, 0) / v.prices.length)
        : null,
      listing_count: v.prices.length,
      last_seen_at:  now,
    }));

  console.log(`[refresh-pedal-feed] ${rows.length} pedals to upsert`);

  if (rows.length > 0) {
    const { error } = await supabase
      .from('recent_pedals')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: false });

    if (error) console.error('[refresh-pedal-feed] upsert error:', error.message);
  }

  // Prune rows not seen in 90 days
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('recent_pedals').delete().lt('last_seen_at', cutoff);

  return new Response(JSON.stringify({ upserted: rows.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
