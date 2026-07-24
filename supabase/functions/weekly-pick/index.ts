// weekly-pick — generates one AI pedal recommendation per Pro user per ISO week.
//
// Priority:
//   1. Pedals TPC has a YouTube video for (fetched live from the TPC channel).
//      Claude picks from this list if any pedal is a good fit for the user.
//   2. Free pick — Claude chooses any pedal, then we search YouTube broadly
//      for a demo video from any channel.
//
// Cache-first: checks weekly_picks table before calling Claude or YouTube.
// Model: claude-haiku-4-5-20251001 (cheap — simple structured output).
// Auth: requires valid Supabase JWT; verifies user is Pro before generating.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const SONNET            = 'claude-sonnet-4-6';
const TPC_CHANNEL_ID    = 'UCatp9V-Jx2KayYer0y052kw';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ─── ISO week key ─────────────────────────────────────────────────────────────
function getWeekKey(): string {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─── Fetch ALL TPC YouTube videos via the uploads playlist ───────────────────
// Uses playlistItems.list (1 quota unit/page) instead of search (100 units/page).
// The uploads playlist ID is the channel ID with "UC" replaced by "UU".
type YTVideo = { id: string; title: string };

async function fetchTpcVideos(ytKey: string): Promise<YTVideo[]> {
  const uploadsPlaylistId = TPC_CHANNEL_ID.replace(/^UC/, 'UU');
  const videos: YTVideo[] = [];
  let pageToken = '';

  try {
    // Safety cap: max 10 pages × 50 = 500 videos — more than enough for any channel
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        part:       'snippet',
        playlistId: uploadsPlaylistId,
        maxResults: '50',
        key:        ytKey,
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);
      if (!res.ok) break;

      const data = await res.json();
      const items = (data.items ?? []) as Record<string, unknown>[];

      for (const item of items) {
        const snippet    = item.snippet as Record<string, unknown> | undefined;
        const resourceId = snippet?.resourceId as Record<string, unknown> | undefined;
        const id         = resourceId?.videoId as string | undefined;
        const title      = snippet?.title as string | undefined;
        if (id && title && title !== 'Private video' && title !== 'Deleted video') {
          videos.push({ id, title });
        }
      }

      pageToken = (data.nextPageToken as string) ?? '';
      if (!pageToken) break; // no more pages
    }
  } catch {
    // Non-fatal — return whatever we collected before the error
  }

  return videos;
}

// ─── Search YouTube broadly for a demo video ──────────────────────────────────
async function searchYouTubeDemo(query: string, ytKey: string): Promise<YTVideo | null> {
  try {
    const params = new URLSearchParams({
      part:       'snippet',
      q:          `${query} pedal demo`,
      type:       'video',
      maxResults: '1',
      key:        ytKey,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const item = (data.items ?? [])[0] as Record<string, unknown> | undefined;
    if (!item) return null;
    return {
      id:    (item.id as Record<string, unknown>)?.videoId as string,
      title: (item.snippet as Record<string, unknown>)?.title as string,
    };
  } catch {
    return null;
  }
}

// ─── Build Claude prompt ──────────────────────────────────────────────────────
function buildPrompt(
  owned:    Array<{ brand: string; model: string; category: string }>,
  wishlist: Array<{ brand: string; model: string }>,
  retired:  Array<{ brand: string; model: string }>,
  profile:  { genres?: string[]; tone_identity?: string; playing_style?: string } | null,
  tpcVideos: YTVideo[],
): string {
  const ownedList   = owned.slice(0, 20).map(p => `${p.brand} ${p.model} (${p.category})`).join('\n  ') || 'none yet';
  const wishList    = wishlist.slice(0, 10).map(p => `${p.brand} ${p.model}`).join('\n  ') || 'none';
  const retiredList = retired.slice(0, 10).map(p => `${p.brand} ${p.model}`).join('\n  ') || 'none';
  const genres      = profile?.genres?.join(', ') || 'not specified';
  const tone        = profile?.tone_identity || 'not described';
  const style       = profile?.playing_style || 'not specified';

  const tpcSection = tpcVideos.length > 0
    ? `\nTPC YouTube videos available (PREFER one of these if it genuinely fits):\n${
        tpcVideos.map(v => `- video_id:${v.id} | "${v.title}"`).join('\n')
      }\n`
    : '';

  return `You are TPC's Weekly Pick engine. A guitarist needs ONE fresh pedal recommendation this week.

HARD RULE: You MUST NOT recommend any pedal from the following lists. These are absolute exclusions — not suggestions.

DO NOT RECOMMEND (currently owned):
  ${ownedList}

DO NOT RECOMMEND (already on wishlist):
  ${wishList}

DO NOT RECOMMEND (previously owned/sold/traded):
  ${retiredList}

Their profile:
- Genres: ${genres}
- Tone identity: ${tone}
- Playing style: ${style}
${tpcSection}
Pick ONE pedal NOT in any of the lists above that would most meaningfully expand their sound. Be specific — name an exact model.

If you pick a pedal from the TPC video list, include its video_id. Otherwise set tpc_video_id to null.

Return ONLY valid JSON with no extra text:
{"brand":"string","model":"string","why":"string (2-3 punchy sentences max)","category":"string","tpc_video_id":"string or null"}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
    const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const ytKey        = Deno.env.get('YOUTUBE_API_KEY') ?? '';

    if (!anthropicKey) return json({ error: 'AI service not configured' }, 500);

    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    // ── Pro gate ──────────────────────────────────────────────────────────────
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profileRow } = await admin
      .from('user_profiles')
      .select('is_premium, pedal_expert_profile')
      .eq('id', user.id)
      .single();

    if (!profileRow?.is_premium) {
      return json({ error: 'pro_required' }, 403);
    }

    // ── Fetch context (needed for cache validation too) ───────────────────────
    const [ownedResult, wishlistResult, retiredResult, tpcVideos] = await Promise.all([
      admin
        .from('user_pedals')
        .select('pedal:pedals(brand, model, category)')
        .eq('user_id', user.id)
        .eq('status', 'owned'),
      admin
        .from('user_pedals')
        .select('pedal:pedals(brand, model)')
        .eq('user_id', user.id)
        .eq('status', 'wishlist'),
      admin
        .from('user_pedals')
        .select('pedal:pedals(brand, model)')
        .eq('user_id', user.id)
        .eq('status', 'retired'),
      ytKey ? fetchTpcVideos(ytKey) : Promise.resolve([]),
    ]);

    const owned = (ownedResult.data ?? [])
      .map((r: { pedal: { brand: string; model: string; category: string } | null }) => r.pedal)
      .filter(Boolean) as Array<{ brand: string; model: string; category: string }>;
    const wishlist = (wishlistResult.data ?? [])
      .map((r: { pedal: { brand: string; model: string } | null }) => r.pedal)
      .filter(Boolean) as Array<{ brand: string; model: string }>;
    const retired = (retiredResult.data ?? [])
      .map((r: { pedal: { brand: string; model: string } | null }) => r.pedal)
      .filter(Boolean) as Array<{ brand: string; model: string }>;

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const allExcluded = [...owned, ...wishlist, ...retired];

    // ── Cache check (re-validate against current ownership) ───────────────────
    const weekKey = getWeekKey();
    const { data: cached } = await admin
      .from('weekly_picks')
      .select('*')
      .eq('user_id', user.id)
      .eq('week_key', weekKey)
      .maybeSingle();

    if (cached) {
      const cachedKey = normalize(`${cached.brand}${cached.model}`);
      const cachedNowOwned = allExcluded.some(p => normalize(`${p.brand}${p.model}`) === cachedKey);
      if (!cachedNowOwned) {
        return json({
          brand:       cached.brand,
          model:       cached.model,
          why:         cached.why,
          category:    cached.category,
          weekKey:     cached.week_key,
          generatedAt: cached.generated_at,
          videoId:     cached.video_id ?? null,
          videoTitle:  cached.video_title ?? null,
          isTpcVideo:  cached.is_tpc_video ?? false,
          fromCache:   true,
        });
      }
      // Cached pick is now owned — delete it so we generate a fresh one
      await admin.from('weekly_picks').delete().eq('id', cached.id);
    }

    const expertProfile = profileRow.pedal_expert_profile as {
      genres?: string[]; tone_identity?: string; playing_style?: string
    } | null;

    // ── Generate with Claude Haiku ────────────────────────────────────────────
    const prompt = buildPrompt(owned, wishlist, retired, expertProfile, tpcVideos);

    const aiRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      console.error('[weekly-pick] Anthropic error:', err);
      return json({ error: 'AI generation failed' }, 500);
    }

    const aiData  = await aiRes.json();
    const rawText = aiData.content?.[0]?.text ?? '';

    let pick: { brand: string; model: string; why: string; category: string; tpc_video_id?: string | null };
    try {
      const cleaned = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      pick = JSON.parse(cleaned);
      if (!pick.brand || !pick.model || !pick.why) throw new Error('incomplete');
    } catch {
      console.error('[weekly-pick] JSON parse failed:', rawText);
      return json({ error: 'Failed to parse AI response' }, 500);
    }

    // Server-side guard: reject picks that match anything the user already owns,
    // wishlisted, or previously owned — catches cases where the model ignores the prompt.
    const pickKey = normalize(`${pick.brand}${pick.model}`);
    const collision = allExcluded.some(p => normalize(`${p.brand}${p.model}`) === pickKey);
    if (collision) {
      console.warn('[weekly-pick] Claude returned excluded pedal:', pick.brand, pick.model);
      return json({ error: 'no_fresh_pick' }, 422);
    }

    // ── Resolve video ─────────────────────────────────────────────────────────
    let videoId:    string | null = null;
    let videoTitle: string | null = null;
    let isTpcVideo = false;

    if (pick.tpc_video_id) {
      // Claude picked from the TPC list — find the matching title
      const tpcMatch = tpcVideos.find(v => v.id === pick.tpc_video_id);
      if (tpcMatch) {
        videoId    = tpcMatch.id;
        videoTitle = tpcMatch.title;
        isTpcVideo = true;
      }
    }

    if (!videoId && ytKey) {
      // Free pick — search YouTube for any good demo
      const demo = await searchYouTubeDemo(`${pick.brand} ${pick.model}`, ytKey);
      if (demo?.id) {
        videoId    = demo.id;
        videoTitle = demo.title;
        isTpcVideo = false;
      }
    }

    // ── Store and return ──────────────────────────────────────────────────────
    const { data: saved, error: insertError } = await admin
      .from('weekly_picks')
      .insert({
        user_id:      user.id,
        brand:        pick.brand,
        model:        pick.model,
        why:          pick.why,
        category:     pick.category ?? null,
        week_key:     weekKey,
        video_id:     videoId,
        video_title:  videoTitle,
        is_tpc_video: isTpcVideo,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[weekly-pick] Insert error:', insertError.message);
    }

    return json({
      brand:       pick.brand,
      model:       pick.model,
      why:         pick.why,
      category:    pick.category ?? null,
      weekKey,
      generatedAt: saved?.generated_at ?? new Date().toISOString(),
      videoId,
      videoTitle,
      isTpcVideo,
      fromCache:   false,
    });

  } catch (e) {
    console.error('[weekly-pick] Unhandled error:', (e as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});
