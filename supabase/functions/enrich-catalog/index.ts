/**
 * enrich-catalog — Supabase Edge Function
 *
 * Systematically works through the pedals catalog, finding and permanently
 * storing the best available image for each pedal.
 *
 * Processing order: gas_count DESC (most-swiped pedals in GAS or Pass first)
 * so the UI improves for the most-seen pedals first.
 *
 * Run modes:
 *   1. Nightly cron — processes pedals lacking any image (batch_size = 40)
 *   2. Upgrade pass — re-processes 'reverb_listing' images to find better ones
 *                    (batch_size = 20, only when ?upgrade=true)
 *
 * Scheduling via pg_cron (run after the migration):
 *
 *   -- Nightly at 2 AM UTC
 *   SELECT cron.schedule(
 *     'enrich-catalog-nightly',
 *     '0 2 * * *',
 *     $$
 *       SELECT net.http_post(
 *         url := current_setting('app.supabase_url') || '/functions/v1/enrich-catalog',
 *         headers := jsonb_build_object(
 *           'Authorization', 'Bearer ' || current_setting('app.service_key'),
 *           'Content-Type', 'application/json'
 *         ),
 *         body := '{}'::jsonb
 *       );
 *     $$
 *   );
 *
 * Or schedule from Supabase Dashboard → Edge Functions → enrich-catalog → Add cron trigger.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REVERB_TOKEN
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL             = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const REVERB_TOKEN             = Deno.env.get('REVERB_TOKEN') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Mirror of pedal-image scoring logic (kept in-process to avoid cold starts) ──

const BRAND_OFFICIAL_SHOPS: Record<string, string> = {
  'boss':                  'boss-us',
  'roland':                'roland-us',
  'electro-harmonix':      'electro-harmonix',
  'ehx':                   'electro-harmonix',
  'strymon':               'strymon',
  'tc electronic':         'tc-electronic',
  'tc electronics':        'tc-electronic',
  'mxr':                   'jim-dunlop',
  'jim dunlop':            'jim-dunlop',
  'dunlop':                'jim-dunlop',
  'walrus audio':          'walrus-audio',
  'eventide':              'eventide',
  'source audio':          'source-audio',
  'keeley':                'keeley-electronics',
  'keeley electronics':    'keeley-electronics',
  'jhs':                   'jhs-pedals',
  'jhs pedals':            'jhs-pedals',
  'chase bliss audio':     'chase-bliss-audio',
  'chase bliss':           'chase-bliss-audio',
  'meris':                 'meris',
  'line 6':                'line-6',
  'zvex':                  'zvex-effects',
  'zvex effects':          'zvex-effects',
  'earthquaker devices':   'earthquaker-devices',
  'earthquaker':           'earthquaker-devices',
  'universal audio':       'universal-audio',
  'neural dsp':            'neural-dsp',
  'wampler':               'wampler-pedals',
  'wampler pedals':        'wampler-pedals',
  'empress effects':       'empress-effects',
  'empress':               'empress-effects',
  'pigtronix':             'pigtronix',
  'catalinbread':          'catalinbread',
  'digitech':              'digitech-new-gear',
  'zoom':                  'zoom-north-america',
  'mooer':                 'mooer-audio',
  'nux':                   'nux-company',
  'joyo':                  'joyo-technology',
  'hotone':                'hotone-music',
  'donner':                'donner-music',
  'caroline guitar company': 'caroline-guitar-company',
  'death by audio':        'death-by-audio',
  'old blood noise':       'old-blood-noise-endeavors',
  'old blood noise endeavors': 'old-blood-noise-endeavors',
  'red panda':             'red-panda',
  'fender':                'fender',
  'darkglass':             'darkglass-electronics',
  'darkglass electronics': 'darkglass-electronics',
  'analogman':             'analogman',
};

const REVERB_HEADERS = {
  Authorization: `Bearer ${REVERB_TOKEN}`,
  'X-Display-Currency': 'USD',
  Accept: 'application/hal+json',
  'Accept-Version': '3.0',
};

type ReverbListing = Record<string, unknown>;

function extractPhotoUrl(listing: ReverbListing): string | null {
  const photos = (listing.photos as Array<Record<string, unknown>>) ?? [];
  const links = (photos[0]?._links as Record<string, unknown>) ?? {};
  return (
    ((links.full as Record<string, unknown>)?.href as string) ??
    ((links.large_crop as Record<string, unknown>)?.href as string) ??
    ((links.small_crop as Record<string, unknown>)?.href as string) ??
    null
  );
}

type ImageSource = 'manufacturer' | 'preferred_seller' | 'reverb_listing';

function scoreAndExtract(
  listing: ReverbListing,
  brandKey: string,
  officialSlug: string | null,
): { photo_url: string; score: number; source: ImageSource } | null {
  const photo_url = extractPhotoUrl(listing);
  if (!photo_url) return null;

  const shop = (listing.shop as { preferred_seller?: boolean; name?: string; slug?: string }) ?? {};
  const shopSlug = (shop.slug ?? '').toLowerCase();
  const shopName = (shop.name ?? '').toLowerCase();
  const photos = (listing.photos as unknown[]) ?? [];
  const links = (
    ((listing.photos as Array<Record<string, unknown>>)?.[0]?._links as Record<string, unknown>) ?? {}
  );

  let score = 0;
  let source: ImageSource = 'reverb_listing';

  if (officialSlug && shopSlug === officialSlug) { score += 25; source = 'manufacturer'; }
  const bw = brandKey.split(' ')[0];
  if (bw.length > 2 && shopName.includes(bw)) {
    score += 12;
    if (source === 'reverb_listing') source = 'preferred_seller';
  }
  if (shop.preferred_seller) {
    score += 8;
    if (source === 'reverb_listing') source = 'preferred_seller';
  }
  if (photos.length >= 5) score += 5;
  else if (photos.length >= 3) score += 3;
  else if (photos.length >= 2) score += 1;
  if ((links.full as Record<string, unknown>)?.href) score += 2;

  return { photo_url, score, source };
}

async function reverbFetch(url: string): Promise<ReverbListing[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: REVERB_HEADERS });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.listings ?? []) as ReverbListing[];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

async function enrichPedal(
  supabase: ReturnType<typeof createClient>,
  pedal: { id: string; brand: string; model: string },
): Promise<'stored' | 'url_only' | 'skipped'> {
  const brandKey = pedal.brand.toLowerCase().trim();
  const officialSlug = BRAND_OFFICIAL_SHOPS[brandKey] ?? null;

  const [officialListings, generalListings] = await Promise.all([
    officialSlug
      ? reverbFetch(
          `https://api.reverb.com/api/listings?shop_slug=${officialSlug}&query=${encodeURIComponent(pedal.model)}&per_page=10`,
        )
      : Promise.resolve<ReverbListing[]>([]),
    reverbFetch(
      `https://api.reverb.com/api/listings?query=${encodeURIComponent(`${pedal.brand} ${pedal.model}`)}&per_page=25`,
    ),
  ]);

  const candidates = [...officialListings, ...generalListings]
    .map(l => scoreAndExtract(l, brandKey, officialSlug))
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (candidates.length === 0) return 'skipped';

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Try to download + store permanently
  let storedUrl: string | null = null;
  let storagePath: string | null = null;

  try {
    const imgRes = await fetch(best.photo_url, { signal: AbortSignal.timeout(12000) });
    if (imgRes.ok) {
      const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const path = `${pedal.id}.${ext}`;
      const buffer = await imgRes.arrayBuffer();

      const { error } = await supabase.storage
        .from('pedal-images')
        .upload(path, buffer, { contentType, upsert: true });

      if (!error) {
        storagePath = path;
        const { data: { publicUrl } } = supabase.storage.from('pedal-images').getPublicUrl(path);
        storedUrl = publicUrl;
      }
    }
  } catch { /* non-critical */ }

  const finalUrl = storedUrl ?? best.photo_url;

  await supabase.from('pedals').update({
    image_url: finalUrl,
    image_source: best.source,
    ...(storagePath ? { image_storage_path: storagePath } : {}),
  }).eq('id', pedal.id);

  return storedUrl ? 'stored' : 'url_only';
}

// ─── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const upgrade = url.searchParams.get('upgrade') === 'true';

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Select pedals to process ──────────────────────────────────────────────
  // Normal run: only pedals with NO image
  // Upgrade run: also includes pedals whose image source is 'reverb_listing'
  //              (we try to find a better, official image for them)
  const batchSize = upgrade ? 20 : 40;

  const { data: pedals, error } = upgrade
    ? await supabase
        .from('pedals')
        .select('id, brand, model')
        .or('image_url.is.null,image_source.eq.reverb_listing')
        .order('gas_count', { ascending: false, nullsFirst: false })
        .limit(batchSize)
    : await supabase
        .from('pedals')
        .select('id, brand, model')
        .is('image_url', null)
        .order('gas_count', { ascending: false, nullsFirst: false })
        .limit(batchSize);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (!pedals || pedals.length === 0) {
    return new Response(
      JSON.stringify({ processed: 0, message: 'Catalog fully enriched ✓' }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  // ── Process each pedal sequentially (avoid Reverb rate limits) ───────────
  const results = { stored: 0, url_only: 0, skipped: 0 };

  for (const pedal of pedals as { id: string; brand: string; model: string }[]) {
    // 300ms throttle between requests to be polite to Reverb's API
    await new Promise(r => setTimeout(r, 300));
    const outcome = await enrichPedal(supabase, pedal);
    results[outcome]++;
  }

  return new Response(
    JSON.stringify({
      processed: pedals.length,
      upgrade,
      ...results,
      message: `Done. ${results.stored} stored to bucket, ${results.url_only} URL-only, ${results.skipped} skipped.`,
    }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
