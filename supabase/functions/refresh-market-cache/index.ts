import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REVERB_TOKEN         = Deno.env.get('REVERB_TOKEN') ?? '';
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET          = Deno.env.get('CRON_SECRET') ?? '';

const REVERB_HEADERS = {
  'Accept': 'application/hal+json',
  'Accept-Version': '3.0',
  'Authorization': `Bearer ${REVERB_TOKEN}`,
};

const STALE_HOURS    = 12;
const MAX_PER_RUN    = 100;   // cap per invocation to stay within timeout
const REVERB_DELAY_MS = 150;  // brief pause between pedals to avoid Reverb rate limits

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

const medianOf = (arr: number[]): number | null => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// deno-lint-ignore no-explicit-any
async function refreshPedal(supabase: any, pedalId: string, brand: string, model: string, condition: string | null, versionLabel: string | null) {
  const conditionKey   = condition ?? 'used';
  const conditionSlugs = condition ? (CONDITION_SLUG_MAP[condition] ?? null) : null;
  const vLabel         = versionLabel ?? '';
  const query          = `${brand} ${model} ${vLabel}`.trim();
  const perPage        = '50';

  const matchesCondition = (l: ReverbListing): boolean => {
    if (!conditionSlugs) return true;
    const slug = l.condition?.slug ?? '';
    return conditionSlugs.some(s => slug === s || slug.startsWith(s));
  };

  const modelTokens = `${model} ${vLabel}`.toLowerCase().split(/[\s/-]+/).filter(t => t.length > 1);
  const MOD_MARKERS = ['waza', 'keeley', 'modded', 'modified', 'analogman', 'analog man', 'alchemy audio', 'monte allums', 'custom shop'];
  const activeMarkers = MOD_MARKERS.filter(m => !model.toLowerCase().includes(m) && !brand.toLowerCase().includes(m));
  const variantPatterns = modelTokens
    .filter(t => /\d/.test(t))
    .map(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z]\\b`, 'i'));

  const isRelevant = (l: ReverbListing): boolean => {
    const title = (l.title ?? '').toLowerCase();
    if (!title) return true;
    if (!modelTokens.every(t => title.includes(t))) return false;
    if (activeMarkers.some(m => title.includes(m))) return false;
    if (variantPatterns.some(re => re.test(title))) return false;
    return true;
  };

  const extractPrices = (listings: ReverbListing[]): number[] =>
    listings
      .filter(isRelevant)
      .filter(matchesCondition)
      .map(l => parseFloat(l.price?.amount ?? '0'))
      .filter(p => p > 0);

  const [listingsData, soldPage1, soldPage2] = await Promise.all([
    fetch(
      `https://api.reverb.com/api/listings?${new URLSearchParams({ query, condition: 'used', per_page: perPage })}`,
      { headers: REVERB_HEADERS }
    ).then(r => r.json()),
    fetch(
      `https://api.reverb.com/api/listings?${new URLSearchParams({ query, condition: 'used', state: 'sold', per_page: perPage, page: '1' })}`,
      { headers: REVERB_HEADERS }
    ).then(r => r.json()).catch(() => null),
    fetch(
      `https://api.reverb.com/api/listings?${new URLSearchParams({ query, condition: 'used', state: 'sold', per_page: perPage, page: '2' })}`,
      { headers: REVERB_HEADERS }
    ).then(r => r.json()).catch(() => null),
  ]);

  const listings = extractPrices((listingsData?.listings ?? []) as ReverbListing[]);
  const sold = extractPrices([
    ...((soldPage1?.listings ?? []) as ReverbListing[]),
    ...((soldPage2?.listings ?? []) as ReverbListing[]),
  ]);

  let tpcSalesValue: number | null = null;
  let tpcSalesCount = 0;
  try {
    const { data: sales } = await supabase
      .from('user_pedals')
      .select('retired_price, condition')
      .eq('pedal_id', pedalId)
      .eq('status', 'retired')
      .eq('retired_method', 'sale')
      .not('retired_price', 'is', null)
      .gt('retired_price', 0);
    if (sales?.length > 0) {
      const rows = sales as Array<{ retired_price: number; condition: string | null }>;
      const conditionMatched = condition ? rows.filter(s => s.condition === condition) : rows;
      const usable = conditionMatched.length >= 2 ? conditionMatched : rows;
      const prices = usable.map(s => s.retired_price);
      tpcSalesCount = prices.length;
      tpcSalesValue = medianOf(prices);
    }
  } catch { /* bonus signal only */ }

  const medList = medianOf(listings);
  const medSold = medianOf(sold);
  const CAP = 40;
  const sources: Array<{ value: number; weight: number }> = [];
  if (tpcSalesValue !== null) sources.push({ value: tpcSalesValue, weight: 1.5 * Math.min(tpcSalesCount, CAP) });
  if (medSold !== null)       sources.push({ value: medSold,       weight: 1.0 * Math.min(sold.length, CAP) });
  if (medList !== null)       sources.push({ value: medList,       weight: 0.5 * Math.min(listings.length, CAP) });

  const totalWeight = sources.reduce((s, x) => s + x.weight, 0);
  const marketValue = totalWeight > 0
    ? sources.reduce((s, x) => s + x.value * x.weight, 0) / totalWeight
    : null;

  await supabase.from('pedal_market_data').upsert({
    pedal_id:        pedalId,
    condition:       conditionKey,
    avg_used_list:   medList       ? Math.round(medList)       : null,
    avg_used_sold:   medSold       ? Math.round(medSold)       : null,
    guide_value:     null,
    tpc_sales_value: tpcSalesValue ? Math.round(tpcSalesValue) : null,
    tpc_sales_count: tpcSalesCount,
    market_value:    marketValue   ? Math.round(marketValue)   : null,
    sample_count:    listings.length + sold.length + tpcSalesCount,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'pedal_id,condition' });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // All active pedal+condition combos across owned vaults and wishlists
  const { data: activePedals, error } = await supabase
    .from('user_pedals')
    .select('pedal_id, condition, pedals(brand, model, version_label)')
    .in('status', ['owned', 'wishlist']);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // Deduplicate by (pedal_id, condition)
  const seen = new Set<string>();
  type PedalCombo = { pedal_id: string; condition: string | null; brand: string; model: string; version_label: string | null };
  const unique: PedalCombo[] = [];
  for (const up of (activePedals ?? [])) {
    const pedal = Array.isArray(up.pedals) ? up.pedals[0] : up.pedals;
    if (!pedal) continue;
    const key = `${up.pedal_id}|${up.condition ?? 'used'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      pedal_id:      up.pedal_id,
      condition:     up.condition,
      brand:         pedal.brand,
      model:         pedal.model,
      version_label: pedal.version_label ?? null,
    });
  }

  // Find stale entries
  const allPedalIds = [...new Set(unique.map(u => u.pedal_id))];
  const { data: cached } = await supabase
    .from('pedal_market_data')
    .select('pedal_id, condition, updated_at')
    .in('pedal_id', allPedalIds);

  const cachedMap = new Map((cached ?? []).map(c => [
    `${c.pedal_id}|${c.condition}`,
    new Date(c.updated_at).getTime(),
  ]));

  const now = Date.now();
  const stale = unique
    .filter(up => {
      const cachedAt = cachedMap.get(`${up.pedal_id}|${up.condition ?? 'used'}`);
      if (!cachedAt) return true;
      return (now - cachedAt) / 3_600_000 >= STALE_HOURS;
    })
    .slice(0, MAX_PER_RUN);

  let refreshed = 0;
  for (const up of stale) {
    try {
      await refreshPedal(supabase, up.pedal_id, up.brand, up.model, up.condition, up.version_label);
      refreshed++;
    } catch { /* best-effort per pedal */ }
    await new Promise(r => setTimeout(r, REVERB_DELAY_MS));
  }

  return new Response(
    JSON.stringify({ refreshed, total_stale: stale.length, total_tracked: unique.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
