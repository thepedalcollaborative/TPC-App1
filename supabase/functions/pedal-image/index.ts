/**
 * pedal-image — Supabase Edge Function
 *
 * Finds the best available image for a single pedal and stores it
 * permanently in the 'pedal-images' Supabase Storage bucket.
 *
 * Scoring strategy (highest score wins):
 *   +25 — listing is from the brand's confirmed official Reverb shop
 *   +12 — shop name contains the brand name (likely brand-owned)
 *   +8  — Reverb "preferred seller" badge (Pro-verified shops)
 *   +5  — listing has 5+ photos (professional shoot)
 *   +3  — listing has 3–4 photos
 *   +1  — listing has 2 photos
 *   +2  — full-resolution photo available
 *
 * Body: { pedal_id: string }
 *
 * Returns:
 *   { image_url: string | null, image_source: string | null, stored: boolean }
 *
 * Required env vars (Supabase Edge Function secrets):
 *   REVERB_TOKEN
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REVERB_TOKEN            = Deno.env.get('REVERB_TOKEN') ?? '';
const SUPABASE_URL            = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const REVERB_HEADERS = {
  Authorization: `Bearer ${REVERB_TOKEN}`,
  'X-Display-Currency': 'USD',
  Accept: 'application/hal+json',
  'Accept-Version': '3.0',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Brand → confirmed official Reverb shop slug ───────────────────────────────
// Key = brand name lowercased (must match pedals.brand case-insensitively)
// Value = Reverb shop slug for that brand's official store
const BRAND_OFFICIAL_SHOPS: Record<string, string> = {
  'boss':                 'boss-us',
  'roland':               'roland-us',
  'electro-harmonix':     'electro-harmonix',
  'ehx':                  'electro-harmonix',
  'strymon':              'strymon',
  'tc electronic':        'tc-electronic',
  'tc electronics':       'tc-electronic',
  'mxr':                  'jim-dunlop',
  'jim dunlop':           'jim-dunlop',
  'dunlop':               'jim-dunlop',
  'walrus audio':         'walrus-audio',
  'eventide':             'eventide',
  'source audio':         'source-audio',
  'keeley':               'keeley-electronics',
  'keeley electronics':   'keeley-electronics',
  'jhs':                  'jhs-pedals',
  'jhs pedals':           'jhs-pedals',
  'chase bliss audio':    'chase-bliss-audio',
  'chase bliss':          'chase-bliss-audio',
  'meris':                'meris',
  'line 6':               'line-6',
  'zvex':                 'zvex-effects',
  'zvex effects':         'zvex-effects',
  'earthquaker devices':  'earthquaker-devices',
  'earthquaker':          'earthquaker-devices',
  'universal audio':      'universal-audio',
  'neural dsp':           'neural-dsp',
  'wampler':              'wampler-pedals',
  'wampler pedals':       'wampler-pedals',
  'empress effects':      'empress-effects',
  'empress':              'empress-effects',
  'pigtronix':            'pigtronix',
  'catalinbread':         'catalinbread',
  'digitech':             'digitech-new-gear',
  'zoom':                 'zoom-north-america',
  'mooer':                'mooer-audio',
  'nux':                  'nux-company',
  'joyo':                 'joyo-technology',
  'hotone':               'hotone-music',
  'donner':               'donner-music',
  'caroline guitar company': 'caroline-guitar-company',
  'death by audio':       'death-by-audio',
  'old blood noise':      'old-blood-noise-endeavors',
  'old blood noise endeavors': 'old-blood-noise-endeavors',
  'red panda':            'red-panda',
  'fender':               'fender',
  'darkglass':            'darkglass-electronics',
  'darkglass electronics':'darkglass-electronics',
  'analogman':            'analogman',
};

// ─── Types ─────────────────────────────────────────────────────────────────────

type ReverbListing = Record<string, unknown>;

type ScoredCandidate = {
  photo_url: string;
  score: number;
  source: 'manufacturer' | 'preferred_seller' | 'reverb_listing';
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function extractPhotoUrl(listing: ReverbListing): string | null {
  const photos = (listing.photos as Array<Record<string, unknown>>) ?? [];
  const links = (photos[0]?._links as Record<string, unknown>) ?? {};
  const full = ((links.full as Record<string, unknown>)?.href as string) ?? null;
  const large = ((links.large_crop as Record<string, unknown>)?.href as string) ?? null;
  const small = ((links.small_crop as Record<string, unknown>)?.href as string) ?? null;
  return full ?? large ?? small ?? null;
}

function scoreListingForImage(
  listing: ReverbListing,
  brandKey: string,
  officialShopSlug: string | null,
): ScoredCandidate | null {
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
  let source: ScoredCandidate['source'] = 'reverb_listing';

  // ── Official brand shop (highest confidence) ────────────────────────────────
  if (officialShopSlug && shopSlug === officialShopSlug) {
    score += 25;
    source = 'manufacturer';
  }

  // ── Shop name contains brand name (likely official or brand-exclusive dealer) ─
  const brandFirstWord = brandKey.split(' ')[0];
  if (brandFirstWord.length > 2 && shopName.includes(brandFirstWord)) {
    score += 12;
    if (source === 'reverb_listing') source = 'preferred_seller';
  }

  // ── Reverb preferred seller (Pro-verified shop) ─────────────────────────────
  if (shop.preferred_seller) {
    score += 8;
    if (source === 'reverb_listing') source = 'preferred_seller';
  }

  // ── Number of photos (more = more professional) ─────────────────────────────
  if (photos.length >= 5) score += 5;
  else if (photos.length >= 3) score += 3;
  else if (photos.length >= 2) score += 1;

  // ── Full-resolution image available ─────────────────────────────────────────
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

// ─── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
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

    const { pedal_id } = (await req.json()) as {
      pedal_id: string;
    };

    if (!pedal_id) {
      return new Response(JSON.stringify({ error: 'pedal_id required' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: pedal, error: pedalError } = await supabase
      .from('pedals')
      .select('brand, model')
      .eq('id', pedal_id)
      .maybeSingle();
    if (pedalError || !pedal?.brand || !pedal?.model) {
      return new Response(JSON.stringify({ error: 'Pedal not found' }), {
        status: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const brand = pedal.brand;
    const model = pedal.model;
    const brandKey = brand.toLowerCase().trim();
    const officialShopSlug = BRAND_OFFICIAL_SHOPS[brandKey] ?? null;

    // ── Fetch from Reverb: official shop + general search in parallel ──────────
    const [officialListings, generalListings] = await Promise.all([
      officialShopSlug
        ? reverbFetch(
            `https://api.reverb.com/api/listings?shop_slug=${officialShopSlug}&query=${encodeURIComponent(model)}&per_page=10`,
          )
        : Promise.resolve<ReverbListing[]>([]),
      reverbFetch(
        `https://api.reverb.com/api/listings?query=${encodeURIComponent(`${brand} ${model}`)}&per_page=25`,
      ),
    ]);

    // ── Score all candidates ──────────────────────────────────────────────────
    const candidates: ScoredCandidate[] = [];
    for (const listing of [...officialListings, ...generalListings]) {
      const candidate = scoreListingForImage(listing, brandKey, officialShopSlug);
      if (candidate) candidates.push(candidate);
    }

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({ image_url: null, image_source: null, stored: false }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    // Best score wins
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // ── Download image → Supabase Storage 'pedal-images' bucket ──────────────
    let storedUrl: string | null = null;
    let imageStoragePath: string | null = null;

    try {
      const imgRes = await fetch(best.photo_url, {
        signal: AbortSignal.timeout(12000),
      });

      if (imgRes.ok) {
        const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
        const ext = contentType.includes('png') ? 'png' : 'jpg';
        const path = `${pedal_id}.${ext}`;
        const buffer = await imgRes.arrayBuffer();

        const { error: uploadError } = await supabase.storage
          .from('pedal-images')
          .upload(path, buffer, { contentType, upsert: true });

        if (!uploadError) {
          imageStoragePath = path;
          const { data: { publicUrl } } = supabase.storage
            .from('pedal-images')
            .getPublicUrl(path);
          storedUrl = publicUrl;
        }
      }
    } catch {
      // Storage upload failed — use direct Reverb URL as fallback (may expire)
    }

    const finalUrl = storedUrl ?? best.photo_url;

    // ── Update pedals table ───────────────────────────────────────────────────
    const updatePayload: Record<string, unknown> = {
      image_url: finalUrl,
      image_source: best.source,
    };
    if (imageStoragePath) updatePayload.image_storage_path = imageStoragePath;

    await supabase.from('pedals').update(updatePayload).eq('id', pedal_id);

    return new Response(
      JSON.stringify({
        image_url: finalUrl,
        image_source: best.source,
        stored: !!storedUrl,
        score: best.score,
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
