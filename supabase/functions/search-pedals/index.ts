import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REVERB_TOKEN = Deno.env.get('REVERB_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map Reverb listing title/categories → our category slugs
const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\bdelay\b|\becho\b|\btape\b/i, 'delay'],
  [/\breverb\b/i, 'reverb'],
  [/\boverdrive\b|\bdistortion\b|\bfuzz\b|\bboost\b|\bdrive\b|\bclip\b/i, 'drive'],
  [/\bchorus\b|\bphaser\b|\bflanger\b|\btremolo\b|\bvibrato\b|\bmod\b/i, 'modulation'],
  [/\bloop\b|\blooper\b/i, 'looper'],
  [/\bpitch\b|\boctave\b|\bwhammy\b|\bharmoniz/i, 'pitch'],
  [/\beq\b|\bequaliz|\bcompress|\bnoise\b|\btuner\b|\bvolume\b|\bexpression\b/i, 'utility'],
  [/\bambient\b|\bdrone\b/i, 'ambient'],
  [/\bmulti.?fx\b|\bmulti.?effect|\bmulti.?stomp/i, 'multifx'],
  [/\bmodeler\b|\bamp.?sim|\bpreamp\b/i, 'modeler'],
  [/\bsynth\b|\bsynthesizer\b/i, 'synth'],
];

const CATEGORY_ALLOWLIST = new Set([
  'drive',
  'delay',
  'reverb',
  'modulation',
  'looper',
  'pitch',
  'utility',
  'ambient',
  'synth',
  'other',
]);

function guessCategory(listing: Record<string, unknown>): string {
  const cats = ((listing.categories ?? []) as Record<string, unknown>[])
    .map((c) => `${c.full_name ?? c.name ?? c.slug ?? ''}`)
    .join(' ');
  const title = (listing.title as string) ?? '';
  const text = `${cats} ${title}`;
  for (const [pattern, cat] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return cat;
  }
  return 'drive';
}

function isEffectsAndPedals(listing: Record<string, unknown>): boolean {
  const cats = ((listing.categories ?? []) as Record<string, unknown>[])
    .map((c) => `${c.full_name ?? c.name ?? c.slug ?? ''}`.toLowerCase());
  const inEffectsTree = cats.some((c) =>
    c.includes('effects and pedals') ||
    c.includes('pedals and effects') ||
    c.includes('effects & pedals') ||
    c.includes('pedals & effects') ||
    c.includes('effects-and-pedals') ||
    c.includes('pedals-and-effects')
  );
  if (inEffectsTree) return true;

  // Fallback: Reverb sometimes returns narrower category labels without the full tree path.
  const catText = cats.join(' ');
  const looksLikeEffectsPedal =
    /\b(reverb|delay|echo|overdrive|distortion|fuzz|chorus|phaser|flanger|tremolo|vibrato|compressor|equalizer|eq|looper|pitch|octave|boost|multi.?effects?|stompbox|pedal)\b/i.test(catText);
  return looksLikeEffectsPedal;
}

function normalizeCategory(input?: string | null): string {
  if (!input) return 'drive';
  const lower = input.toLowerCase();
  return CATEGORY_ALLOWLIST.has(lower) ? lower : 'drive';
}

async function fetchFirstPhotoUrl(query: string): Promise<string | null> {
  if (!REVERB_TOKEN) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://api.reverb.com/api/listings?query=${encodeURIComponent(query)}&per_page=10`;
    const reverbRes = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${REVERB_TOKEN}`,
        'X-Display-Currency': 'USD',
        Accept: 'application/hal+json',
        'Accept-Version': '3.0',
      },
    });
    clearTimeout(timer);
    if (!reverbRes.ok) return null;
    const reverbData = await reverbRes.json();
    const allListings: Record<string, unknown>[] = reverbData.listings ?? [];
    const listings = allListings.filter(isEffectsAndPedals);
    for (const listing of listings) {
      const photos = (listing.photos as Array<Record<string, unknown>>) ?? [];
      const links = (photos[0]?._links as Record<string, unknown>) ?? {};
      const photo_url =
        ((links.full as Record<string, unknown>)?.href as string) ??
        ((links.large_crop as Record<string, unknown>)?.href as string) ??
        ((links.small_crop as Record<string, unknown>)?.href as string) ??
        null;
      if (photo_url) return photo_url;
    }
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const body = await req.json();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Upsert mode: called when user picks a Reverb-only result ───────────────
  if (body.action === 'upsert') {
    const { brand, model, category, avg_price, subcategory, description, analog, in_production } = body as {
      brand: string;
      model: string;
      category?: string | null;
      subcategory?: string | null;
      description?: string | null;
      analog?: boolean | null;
      in_production?: boolean | null;
      avg_price: number | null;
    };
    const safeCategory = normalizeCategory(category);

    // Check for existing match (case-insensitive)
    const { data: existing } = await supabase
      .from('pedals')
      .select('*')
      .ilike('brand', brand)
      .ilike('model', model)
      .maybeSingle();

    let image_url = (body as { image_url?: string }).image_url ?? null;
    if (!image_url) {
      image_url = await fetchFirstPhotoUrl(`${brand} ${model}`);
    }

    if (existing) {
      if (!existing.image_url && image_url) {
        const { data: updated } = await supabase
          .from('pedals')
          .update({ image_url })
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
        model,
        category: safeCategory,
        subcategory: subcategory ?? null,
        description: description ?? null,
        analog: analog ?? false,
        in_production: in_production ?? true,
        avg_price: avg_price ?? null,
        image_url: image_url ?? null,
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

  // ── Local-only catalog search (no Reverb) ──────────────────────────────────
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

  // ── Listings mode (Reverb listings only) ───────────────────────────────────
  if (body.action === 'listings') {
    const query = (body.query as string)?.trim();
    const sort = (body.sort as string) ?? 'newest';
    if (!query) {
      return new Response(JSON.stringify({ listings: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const url = `https://api.reverb.com/api/listings?query=${encodeURIComponent(query)}&per_page=25`;
      const reverbRes = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${REVERB_TOKEN}`,
          'X-Display-Currency': 'USD',
          Accept: 'application/hal+json',
          'Accept-Version': '3.0',
        },
      });
      clearTimeout(timer);

      if (!reverbRes.ok) {
        const errBody = await reverbRes.text();
        return new Response(JSON.stringify({
          listings: [],
          _debug: { stage: 'reverb_http', reverbStatus: reverbRes.status, reverbError: errBody, tokenSet: !!REVERB_TOKEN },
        }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      const reverbData = await reverbRes.json();
      const listings: Record<string, unknown>[] = reverbData.listings ?? [];

      const filtered = listings.filter(isEffectsAndPedals).map((listing) => {
        const priceObj = (listing.price as { amount?: string; currency?: string }) ?? {};
        const price = priceObj.amount ? parseFloat(priceObj.amount) : null;
        const currency = priceObj.currency ?? null;
        const condition = (listing.condition as { display_name?: string; name?: string })?.display_name
          ?? (listing.condition as { name?: string })?.name
          ?? null;
        const date = (listing.published_at as string) ?? (listing.created_at as string) ?? null;
        const url =
          ((listing as { _links?: { web?: { href?: string } } })._links?.web?.href as string) ??
          null;
        const photos = (listing.photos as Array<Record<string, unknown>>) ?? [];
        const links = (photos[0]?._links as Record<string, unknown>) ?? {};
        const photo_url =
          ((links.full as Record<string, unknown>)?.href as string) ??
          ((links.large_crop as Record<string, unknown>)?.href as string) ??
          ((links.small_crop as Record<string, unknown>)?.href as string) ??
          null;
        const title = (listing.title as string) ?? `${listing.make ?? ''} ${listing.model ?? ''}`.trim();
        return { title, price, currency, condition, date, url, photo_url };
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
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({
        listings: [],
        _debug: { stage: 'exception', error: message, tokenSet: !!REVERB_TOKEN },
      }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Search mode ────────────────────────────────────────────────────────────
  const query = (body.query as string)?.trim();
  if (!query) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    // Fetch Reverb listings (8-second timeout so we never hang the edge function)
    const url = `https://api.reverb.com/api/listings?query=${encodeURIComponent(query)}&per_page=25`;
    const reverbRes = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${REVERB_TOKEN}`,
        'X-Display-Currency': 'USD',
        Accept: 'application/hal+json',
        'Accept-Version': '3.0',
      },
    });
    clearTimeout(timer);

    if (!reverbRes.ok) {
      const errBody = await reverbRes.text();
      return new Response(JSON.stringify({
        results: [],
        _debug: { stage: 'reverb_http', reverbStatus: reverbRes.status, reverbError: errBody, tokenSet: !!REVERB_TOKEN },
      }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const reverbData = await reverbRes.json();
    const listings: Record<string, unknown>[] = (reverbData.listings ?? []).filter(isEffectsAndPedals);

    // Dedupe by brand+model, averaging prices across duplicate listings
    const byKey = new Map<string, { brand: string; model: string; category: string; prices: number[]; photo_url: string | null }>();

    for (const listing of listings) {
      const brand = ((listing.make as string) ?? '').trim();
      const model = ((listing.model as string) ?? '').trim();
      if (!brand || !model) continue;

      const key = `${brand.toLowerCase()}|${model.toLowerCase()}`;
      if (!byKey.has(key)) {
        // Extract the first usable photo URL from this listing
        const photos = (listing.photos as Array<Record<string, unknown>>) ?? [];
        const links = (photos[0]?._links as Record<string, unknown>) ?? {};
        const photo_url =
          ((links.full as Record<string, unknown>)?.href as string) ??
          ((links.large_crop as Record<string, unknown>)?.href as string) ??
          ((links.small_crop as Record<string, unknown>)?.href as string) ??
          null;
        byKey.set(key, { brand, model, category: guessCategory(listing), prices: [], photo_url });
      }
      const price = (listing.price as { amount?: string })?.amount;
      if (price) byKey.get(key)!.prices.push(parseFloat(price));
    }

    const candidates = [...byKey.values()].map((c) => ({
      brand: c.brand,
      model: c.model,
      category: c.category,
      photo_url: c.photo_url,
      avg_price: c.prices.length > 0
        ? Math.round(c.prices.reduce((a, b) => a + b, 0) / c.prices.length)
        : null,
    }));

    if (candidates.length === 0) {
      return new Response(JSON.stringify({
        results: [],
        _debug: { stage: 'no_candidates', listingCount: listings.length, tokenSet: !!REVERB_TOKEN },
      }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Check which are already in our pedals table
    const brands = [...new Set(candidates.map((c) => c.brand))];
    const { data: existing } = await supabase
      .from('pedals')
      .select('id, brand, model')
      .in('brand', brands);

    const inCatalog = new Map<string, string>(
      (existing ?? []).map((p: { id: string; brand: string; model: string }) => [
        `${p.brand.toLowerCase()}|${p.model.toLowerCase()}`,
        p.id,
      ])
    );

    const results = candidates.map((c) => {
      const key = `${c.brand.toLowerCase()}|${c.model.toLowerCase()}`;
      return {
        brand: c.brand,
        model: c.model,
        category: c.category,
        avg_price: c.avg_price,
        photo_url: c.photo_url,
        in_catalog: inCatalog.has(key),
        pedal_id: inCatalog.get(key) ?? null,
      };
    });

    // Catalog-matched results first
    results.sort((a, b) => Number(b.in_catalog) - Number(a.in_catalog));

    return new Response(JSON.stringify({ results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({
      results: [],
      _debug: { stage: 'exception', error: message, tokenSet: !!REVERB_TOKEN },
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
