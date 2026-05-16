/**
 * search-pedals — Supabase Edge Function
 *
 * Central hub for all pedal search, image enrichment, and upsert operations.
 *
 * IMPORTANT: This function uses Reverb listing.make + listing.model (structured
 * fields) — NOT the listing title — for brand and model. This avoids all the
 * noise users add to their listing titles ("w/ box", "minty", condition words, etc).
 *
 * Modes (determined by request body):
 *
 *   Search (default)
 *     Body: { query: string }
 *     Searches Reverb for the query, dedupes by brand+model, scores each
 *     candidate's available photo by quality (official shop > preferred seller >
 *     regular listing), cross-references with local catalog.
 *     Returns: { results: FinderPedal[] }
 *
 *   Local-only catalog search
 *     Body: { query: string, localOnly: true }
 *     Searches pedals table only — no Reverb call.
 *     Returns: { pedals: Pedal[] }
 *
 *   Listings (buy/sell data for wishlist detail)
 *     Body: { action: 'listings', query: string, sort?: 'newest' | 'price' }
 *     Returns current Reverb marketplace listings for a specific pedal.
 *     Returns: { listings: ListingItem[] }
 *
 *   Upsert (catalog write)
 *     Body: { action: 'upsert', brand, model, category, ...fields }
 *     Creates or updates a pedal catalog entry. Uses quality-scored image.
 *     Returns: { pedal: Pedal }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REVERB_TOKEN              = Deno.env.get('REVERB_TOKEN')!;
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const REVERB_HEADERS = {
  Authorization: `Bearer ${REVERB_TOKEN}`,
  'X-Display-Currency': 'USD',
  Accept: 'application/hal+json',
  'Accept-Version': '3.0',
};

// ─── Brand official shop lookup (same as pedal-image function) ─────────────────
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

// ─── Category mapping ──────────────────────────────────────────────────────────
const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\bdelay\b|\becho\b|\btape\s+delay\b/i, 'delay'],
  [/\breverb\b/i, 'reverb'],
  [/\boverdrive\b|\bdistortion\b|\bfuzz\b|\bdrive\b|\bclip\b/i, 'drive'],
  [/\bboost\b/i, 'drive'],
  [/\bchorus\b|\bphaser\b|\bflanger\b|\btremolo\b|\bvibrato\b/i, 'modulation'],
  [/\bloop\b|\blooper\b/i, 'looper'],
  [/\bpitch\b|\boctave\b|\bwhammy\b|\bharmoniz/i, 'pitch'],
  [/\beq\b|\bequaliz|\bcompress|\bnoise\s+gate\b|\bgate\b|\btuner\b|\bvolume\s+pedal\b/i, 'utility'],
  [/\bambient\b|\bdrone\b/i, 'ambient'],
  [/\bmulti.?fx\b|\bmulti.?effect|\bmulti.?stomp/i, 'multifx'],
  [/\bmodeler\b|\bamp.?sim|\bpreamp\b/i, 'modeler'],
  [/\bsynth\b|\bsynthesizer\b/i, 'synth'],
];

const CATEGORY_ALLOWLIST = new Set([
  'drive', 'delay', 'reverb', 'modulation', 'looper', 'pitch',
  'utility', 'ambient', 'synth', 'other', 'multifx', 'modeler',
]);

// ─── Helpers ───────────────────────────────────────────────────────────────────

type ReverbListing = Record<string, unknown>;

/**
 * Normalise a Reverb `model` field.
 * Reverb's model field is generally clean, but occasionally gets condition
 * words or acquisition noise appended. Strip those without touching real
 * model-name tokens (effect type words, version numbers, colour names that
 * are actually part of the model, etc.).
 */
function normalizeModel(raw: string): string {
  return raw
    // "DS-1 — Used" / "DS-1 - Excellent"
    .replace(/\s*[-–—]\s*(used|like\s+new|mint|excellent|very\s+good|good|fair|poor)\b.*/i, '')
    // "DS-1 (Used)" / "DS-1 (Mint Condition)"
    .replace(/\s*\(\s*(used|like\s+new|mint|excellent|very\s+good|good|fair|poor)[^)]*\)\s*$/i, '')
    // "DS-1 w/ box" / "DS-1 with original box"
    .replace(/\s+(w\/|w\s+)(original\s+)?(box|case|manual|bag)\s*$/i, '')
    // Collapse spaces
    .replace(/\s+/g, ' ')
    .trim();
}

function guessCategory(listing: ReverbListing): string {
  // Prefer Reverb's own category tree over title-based guessing
  const cats = ((listing.categories ?? []) as Record<string, unknown>[])
    .map((c) => `${c.full_name ?? c.name ?? c.slug ?? ''}`)
    .join(' ');
  const text = cats || (listing.title as string ?? '');
  for (const [pattern, cat] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return cat;
  }
  return 'other';
}

function normalizeCategory(input?: string | null): string {
  if (!input) return 'other';
  const lower = input.toLowerCase();
  return CATEGORY_ALLOWLIST.has(lower) ? lower : 'other';
}

function isEffectsAndPedals(listing: ReverbListing): boolean {
  const cats = ((listing.categories ?? []) as Record<string, unknown>[])
    .map((c) => `${c.full_name ?? c.name ?? c.slug ?? ''}`.toLowerCase());
  if (cats.some((c) =>
    c.includes('effects and pedals') || c.includes('pedals and effects') ||
    c.includes('effects & pedals') || c.includes('pedals & effects') ||
    c.includes('effects-and-pedals') || c.includes('pedals-and-effects')
  )) return true;
  // Narrower category labels from Reverb
  const catText = cats.join(' ');
  return /\b(reverb|delay|echo|overdrive|distortion|fuzz|chorus|phaser|flanger|tremolo|vibrato|compressor|equalizer|eq|looper|pitch|octave|boost|multi.?effects?|stompbox|pedal)\b/i.test(catText);
}

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

/**
 * Score a listing's suitability as the canonical photo for a pedal.
 * Returns { photo_url, score } — higher score = better image source.
 */
function scorePhoto(
  listing: ReverbListing,
  brandKey: string,
): { photo_url: string; score: number } | null {
  const photo_url = extractPhotoUrl(listing);
  if (!photo_url) return null;

  const shop = (listing.shop as { preferred_seller?: boolean; name?: string; slug?: string }) ?? {};
  const shopSlug   = (shop.slug  ?? '').toLowerCase();
  const shopName   = (shop.name  ?? '').toLowerCase();
  const officialSlug = BRAND_OFFICIAL_SHOPS[brandKey] ?? null;
  const photos = (listing.photos as unknown[]) ?? [];
  const links = (
    ((listing.photos as Array<Record<string, unknown>>)?.[0]?._links as Record<string, unknown>) ?? {}
  );

  let score = 0;

  // Official brand store (highest quality — manufacturer photos)
  if (officialSlug && shopSlug === officialSlug) score += 25;

  // Shop name contains brand name (official or brand-exclusive dealer)
  const brandFirstWord = brandKey.split(' ')[0];
  if (brandFirstWord.length > 2 && shopName.includes(brandFirstWord)) score += 12;

  // Reverb preferred seller (Pro-verified — professional sellers)
  if (shop.preferred_seller) score += 8;

  // Photo count: more photos = more professional shoot
  if (photos.length >= 5) score += 5;
  else if (photos.length >= 3) score += 3;
  else if (photos.length >= 2) score += 1;

  // Full-res photo available (not just crops)
  if ((links.full as Record<string, unknown>)?.href) score += 2;

  return { photo_url, score };
}

async function reverbFetch(url: string): Promise<ReverbListing[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
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

/**
 * Multi-strategy Reverb search for finding obscure / boutique pedals.
 *
 * Problem: /api/listings defaults to only *live* (currently for-sale) listings.
 * A boutique pedal like "Hologram Chroma Console" may have zero active listings
 * at any given moment, so we get nothing back even though it exists on Reverb.
 *
 * All four strategies fire in PARALLEL so there is zero extra latency for the
 * common case (strategy 1 wins immediately). Results are prioritised in order:
 *   1. Full query  — live listings only  (fast, common case)
 *   2. Full query  — ended/sold listings (same pedal, just no longer for sale)
 *   3. Model token — live listings        (broader; drops brand prefix)
 *   4. Model token — ended/sold listings  (broadest fallback)
 *
 * Ended listings still carry structured make/model/photos, so they work
 * perfectly for catalog-building purposes even though they are not buyable.
 */
async function reverbSearchWithFallback(
  query: string,
): Promise<{ listings: ReverbListing[]; strategy: string }> {
  const encoded = encodeURIComponent(query);
  const tokens = query.trim().split(/\s+/);
  const modelToken = tokens.length > 1 ? tokens.slice(1).join(' ') : query;
  const encodedModel = encodeURIComponent(modelToken);
  const hasModelToken = modelToken !== query;

  // Fire all strategies simultaneously — no sequential waiting
  const [live, ended, modelLive, modelEnded] = await Promise.all([
    reverbFetch(`https://api.reverb.com/api/listings?query=${encoded}&per_page=25`),
    reverbFetch(`https://api.reverb.com/api/listings?query=${encoded}&per_page=25&state=ended`),
    hasModelToken
      ? reverbFetch(`https://api.reverb.com/api/listings?query=${encodedModel}&per_page=25`)
      : Promise.resolve([] as ReverbListing[]),
    hasModelToken
      ? reverbFetch(`https://api.reverb.com/api/listings?query=${encodedModel}&per_page=25&state=ended`)
      : Promise.resolve([] as ReverbListing[]),
  ]);

  if (live.length > 0)       return { listings: live,       strategy: 'live_full' };
  if (ended.length > 0)      return { listings: ended,      strategy: 'ended_full' };
  if (modelLive.length > 0)  return { listings: modelLive,  strategy: 'live_model_token' };
  if (modelEnded.length > 0) return { listings: modelEnded, strategy: 'ended_model_token' };

  return { listings: [], strategy: 'no_results' };
}

// ─── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
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

  const body = await req.json().catch(() => ({}));
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Upsert mode ─────────────────────────────────────────────────────────────
  if (body.action === 'upsert') {
    const {
      brand, model, category, subcategory, description,
      analog, in_production, avg_price,
    } = body as {
      brand: string; model: string; category?: string | null;
      subcategory?: string | null; description?: string | null;
      analog?: boolean | null; in_production?: boolean | null;
      avg_price: number | null;
    };

    const safeCategory = normalizeCategory(category);
    const cleanModel = normalizeModel(model);

    // Check for existing (case-insensitive)
    const { data: existing } = await supabase
      .from('pedals')
      .select('*')
      .ilike('brand', brand)
      .ilike('model', cleanModel)
      .maybeSingle();

    // Find best image via quality scoring
    let image_url: string | null = (body as { image_url?: string }).image_url ?? null;
    let image_source: string | null = null;

    if (!image_url || !existing?.image_url) {
      // Fetch listings (with fallback to ended listings) and pick the best photo
      const { listings } = await reverbSearchWithFallback(`${brand} ${cleanModel}`);
      const scored = listings
        .map(l => scorePhoto(l, brand.toLowerCase()))
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => b.score - a.score);

      if (scored.length > 0) {
        image_url = scored[0].photo_url;
        const shop = (listings.find(l => extractPhotoUrl(l) === image_url)?.shop as { preferred_seller?: boolean; slug?: string }) ?? {};
        const officialSlug = BRAND_OFFICIAL_SHOPS[brand.toLowerCase()] ?? null;
        if (officialSlug && (shop.slug ?? '').toLowerCase() === officialSlug) {
          image_source = 'manufacturer';
        } else if (shop.preferred_seller) {
          image_source = 'preferred_seller';
        } else {
          image_source = 'reverb_listing';
        }
      }
    }

    if (existing) {
      // Only update image if we found a better one (or the existing has none)
      const shouldUpdateImage = !existing.image_url && image_url;
      if (shouldUpdateImage) {
        const { data: updated } = await supabase
          .from('pedals')
          .update({ image_url, image_source })
          .eq('id', existing.id)
          .select()
          .single();
        return new Response(JSON.stringify({ pedal: updated ?? existing }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ pedal: existing }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { data: inserted, error } = await supabase
      .from('pedals')
      .insert({
        brand,
        model: cleanModel,
        category: safeCategory,
        subcategory: subcategory ?? null,
        description: description ?? null,
        analog: analog ?? false,
        in_production: in_production ?? true,
        avg_price: avg_price ?? null,
        image_url: image_url ?? null,
        image_source: image_source ?? null,
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ pedal: inserted }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Local-only catalog search ────────────────────────────────────────────────
  if (body.localOnly) {
    const rawQ = ((body.query as string) ?? '').replace(/[^a-zA-Z0-9 \-_.]/g, '').trim().slice(0, 100);
    if (!rawQ) {
      return new Response(JSON.stringify({ pedals: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const { data, error } = await supabase
      .from('pedals')
      .select('*')
      .or(`brand.ilike.%${rawQ}%,model.ilike.%${rawQ}%`)
      .order('brand')
      .limit(10);

    return new Response(JSON.stringify({ pedals: error ? [] : (data ?? []) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Listings mode (marketplace data for wishlist detail) ─────────────────────
  if (body.action === 'listings') {
    const query = (body.query as string)?.trim();
    const sort  = (body.sort  as string) ?? 'newest';
    if (!query) {
      return new Response(JSON.stringify({ listings: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const allListings = await reverbFetch(
      `https://api.reverb.com/api/listings?query=${encodeURIComponent(query)}&per_page=25`,
    );
    const filtered = allListings.filter(isEffectsAndPedals).map((listing) => {
      const priceObj = (listing.price as { amount?: string; currency?: string }) ?? {};
      const price = priceObj.amount ? parseFloat(priceObj.amount) : null;
      const condition = (listing.condition as { display_name?: string })?.display_name ?? null;
      const date = (listing.published_at as string) ?? (listing.created_at as string) ?? null;
      const url = ((listing as { _links?: { web?: { href?: string } } })._links?.web?.href) ?? null;
      const photo_url = extractPhotoUrl(listing);
      // Use make+model (structured fields) for the display title — not the user-typed listing title
      const make  = (listing.make  as string ?? '').trim();
      const model = (listing.model as string ?? '').trim();
      const title = make && model
        ? `${make} ${model}`
        : (listing.title as string ?? `${make} ${model}`).trim();
      return { title, price, currency: priceObj.currency ?? null, condition, date, url, photo_url };
    });

    if (sort === 'price') {
      filtered.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    } else {
      filtered.sort((a, b) => {
        const ad = a.date ? Date.parse(a.date) : 0;
        const bd = b.date ? Date.parse(b.date) : 0;
        return bd - ad;
      });
    }

    return new Response(JSON.stringify({ listings: filtered }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Search mode (main path: query → Reverb → scored results) ────────────────
  const query = (body.query as string)?.trim();
  if (!query) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { listings: allListings, strategy } = await reverbSearchWithFallback(query);

    if (allListings.length === 0) {
      return new Response(JSON.stringify({ results: [], _debug: { stage: 'no_reverb_results', strategy } }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // In search mode we trust the query to be pedal-specific — skip the
    // isEffectsAndPedals category filter here so boutique/obscure brands
    // whose Reverb category labels don't match our patterns still come through.
    const listings = allListings;

    // ── Dedupe by brand+model; for each unique pedal pick the best photo ───────
    // Key: `brand|model` (both lowercased)
    const byKey = new Map<string, {
      brand: string;
      model: string;
      category: string;
      prices: number[];
      bestPhoto: { photo_url: string; score: number } | null;
    }>();

    for (const listing of listings) {
      // Use Reverb's structured make/model — NOT the user-typed title.
      // Fall back to title parsing when structured fields are missing (some
      // boutique sellers don't fill them in).
      let rawBrand = ((listing.make  as string) ?? '').trim();
      let rawModel = ((listing.model as string) ?? '').trim();

      if (!rawBrand || !rawModel) {
        const title = ((listing.title as string) ?? '').trim();
        if (!title) continue;
        // Try to split "Brand Model Name" — first word = brand, rest = model
        const parts = title.split(/\s+/);
        if (parts.length < 2) continue;
        rawBrand = rawBrand || parts[0];
        rawModel = rawModel || parts.slice(1).join(' ');
      }

      if (!rawBrand || !rawModel) continue;

      const brand = rawBrand;
      const model = normalizeModel(rawModel);
      const key   = `${brand.toLowerCase()}|${model.toLowerCase()}`;

      if (!byKey.has(key)) {
        byKey.set(key, {
          brand,
          model,
          category: guessCategory(listing),
          prices: [],
          bestPhoto: null,
        });
      }

      const entry = byKey.get(key)!;

      // Score this listing's photo and keep best so far
      const scored = scorePhoto(listing, brand.toLowerCase());
      if (scored && (!entry.bestPhoto || scored.score > entry.bestPhoto.score)) {
        entry.bestPhoto = scored;
      }

      const price = (listing.price as { amount?: string })?.amount;
      if (price) entry.prices.push(parseFloat(price));
    }

    const candidates = [...byKey.values()].map((c) => ({
      brand:     c.brand,
      model:     c.model,
      category:  c.category,
      photo_url: c.bestPhoto?.photo_url ?? null,
      avg_price: c.prices.length > 0
        ? Math.round(c.prices.reduce((a, b) => a + b, 0) / c.prices.length)
        : null,
    }));

    if (candidates.length === 0) {
      return new Response(JSON.stringify({ results: [], _debug: { stage: 'no_candidates' } }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Cross-reference with local catalog ─────────────────────────────────────
    const uniqueBrands = [...new Set(candidates.map((c) => c.brand))];
    const { data: existing } = await supabase
      .from('pedals')
      .select('id, brand, model, image_url, image_source')
      .in('brand', uniqueBrands);

    const inCatalog = new Map<string, { id: string; image_url: string | null; image_source: string | null }>(
      (existing ?? []).map((p: { id: string; brand: string; model: string; image_url: string | null; image_source: string | null }) => [
        `${p.brand.toLowerCase()}|${p.model.toLowerCase()}`,
        { id: p.id, image_url: p.image_url, image_source: p.image_source },
      ])
    );

    const results = candidates.map((c) => {
      const key = `${c.brand.toLowerCase()}|${c.model.toLowerCase()}`;
      const catalogEntry = inCatalog.get(key) ?? null;

      // Prefer the catalog's stored image (could be manufacturer-sourced)
      // over the freshly fetched Reverb photo
      const photo_url = catalogEntry?.image_url ?? c.photo_url;

      return {
        brand:      c.brand,
        model:      c.model,
        category:   c.category,
        avg_price:  c.avg_price,
        photo_url,
        in_catalog: !!catalogEntry,
        pedal_id:   catalogEntry?.id ?? null,
      };
    });

    // Catalog matches first, then Reverb-only results
    results.sort((a, b) => Number(b.in_catalog) - Number(a.in_catalog));

    return new Response(JSON.stringify({ results, _debug: { strategy } }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ results: [], _debug: { stage: 'exception', error: message } }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
