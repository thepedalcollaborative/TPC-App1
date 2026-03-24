// weekly-pick — generates one AI pedal recommendation per Pro user per ISO week.
//
// Cache-first: checks weekly_picks table before calling Claude.
// Model: claude-haiku-4-5-20251001 (cheap — simple structured output, no streaming).
// Auth: requires valid Supabase JWT; verifies user is Pro before generating.
//
// Deploy: npx supabase functions deploy weekly-pick --no-verify-jwt
// (JWT is verified manually below so we can return a structured error to the client)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU = 'claude-haiku-4-5-20251001';

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
  const day = d.getUTCDay() || 7;          // 1 Mon … 7 Sun
  d.setUTCDate(d.getUTCDate() + 4 - day);  // shift to nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─── Build user context for prompt ───────────────────────────────────────────
function buildPrompt(
  owned: Array<{ brand: string; model: string; category: string }>,
  wishlist: Array<{ brand: string; model: string }>,
  profile: { genres?: string[]; tone_identity?: string; playing_style?: string } | null,
): string {
  const ownedList = owned.slice(0, 20).map(p => `${p.brand} ${p.model} (${p.category})`).join(', ') || 'none yet';
  const wishList = wishlist.slice(0, 10).map(p => `${p.brand} ${p.model}`).join(', ') || 'none';
  const genres = profile?.genres?.join(', ') || 'not specified';
  const tone = profile?.tone_identity || 'not described';
  const style = profile?.playing_style || 'not specified';

  return `You are TPC's Weekly Pick engine. A guitarist needs ONE fresh pedal recommendation this week.

Their current rig:
- Owned pedals: ${ownedList}
- Wishlist: ${wishList}
- Genres: ${genres}
- Tone identity: ${tone}
- Playing style: ${style}

Pick ONE pedal they don't own yet that would most meaningfully expand their sound. Avoid anything already on their wishlist. Be specific — name an exact model, not a generic suggestion.

Return ONLY valid JSON with no extra text:
{"brand":"string","model":"string","why":"string (2-3 punchy sentences max)","category":"string"}`;
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
    if (!anthropicKey) return json({ error: 'AI service not configured' }, 500);

    // Use anon client to verify JWT
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
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

    // ── Cache check ───────────────────────────────────────────────────────────
    const weekKey = getWeekKey();
    const { data: cached } = await admin
      .from('weekly_picks')
      .select('*')
      .eq('user_id', user.id)
      .eq('week_key', weekKey)
      .maybeSingle();

    if (cached) {
      return json({
        brand:       cached.brand,
        model:       cached.model,
        why:         cached.why,
        category:    cached.category,
        weekKey:     cached.week_key,
        generatedAt: cached.generated_at,
        fromCache:   true,
      });
    }

    // ── Fetch user context ────────────────────────────────────────────────────
    const [{ data: ownedRows }, { data: wishlistRows }] = await Promise.all([
      admin
        .from('user_pedals')
        .select('pedal:pedals(brand, model, category)')
        .eq('user_id', user.id)
        .eq('status', 'owned')
        .limit(20),
      admin
        .from('user_pedals')
        .select('pedal:pedals(brand, model)')
        .eq('user_id', user.id)
        .eq('status', 'wishlist')
        .limit(10),
    ]);

    const owned = (ownedRows ?? []).map((r: { pedal: { brand: string; model: string; category: string } | null }) => r.pedal).filter(Boolean) as Array<{ brand: string; model: string; category: string }>;
    const wishlist = (wishlistRows ?? []).map((r: { pedal: { brand: string; model: string } | null }) => r.pedal).filter(Boolean) as Array<{ brand: string; model: string }>;
    const expertProfile = profileRow.pedal_expert_profile as { genres?: string[]; tone_identity?: string; playing_style?: string } | null;

    // ── Generate with Claude Haiku ────────────────────────────────────────────
    const prompt = buildPrompt(owned, wishlist, expertProfile);

    const aiRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      console.error('[weekly-pick] Anthropic error:', err);
      return json({ error: 'AI generation failed' }, 500);
    }

    const aiData = await aiRes.json();
    const rawText = aiData.content?.[0]?.text ?? '';

    let pick: { brand: string; model: string; why: string; category: string };
    try {
      // Strip markdown code fences if present
      const cleaned = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      pick = JSON.parse(cleaned);
      if (!pick.brand || !pick.model || !pick.why) throw new Error('incomplete');
    } catch {
      console.error('[weekly-pick] JSON parse failed:', rawText);
      return json({ error: 'Failed to parse AI response' }, 500);
    }

    // ── Store and return ──────────────────────────────────────────────────────
    const { data: saved, error: insertError } = await admin
      .from('weekly_picks')
      .insert({
        user_id:  user.id,
        brand:    pick.brand,
        model:    pick.model,
        why:      pick.why,
        category: pick.category ?? null,
        week_key: weekKey,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[weekly-pick] Insert error:', insertError.message);
      // If unique conflict, another request raced us — return what we generated
    }

    return json({
      brand:       pick.brand,
      model:       pick.model,
      why:         pick.why,
      category:    pick.category ?? null,
      weekKey,
      generatedAt: saved?.generated_at ?? new Date().toISOString(),
      fromCache:   false,
    });

  } catch (e) {
    console.error('[weekly-pick] Unhandled error:', (e as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});
