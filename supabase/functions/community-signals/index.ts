import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const payload = body as {
    action: string;
    collection_pedal_ids?: string[];
    gap_categories?: string[];
    profile_genres?: string[];
    profile_guitar_type?: string;
  };
  const action = payload.action;

  const collection_pedal_ids = (payload.collection_pedal_ids ?? [])
    .filter((v) => typeof v === 'string' && /^[0-9a-fA-F-]{36}$/.test(v))
    .slice(0, 50);
  const gap_categories = (payload.gap_categories ?? [])
    .filter((v) => typeof v === 'string')
    .slice(0, 20);
  const profile_genres = (payload.profile_genres ?? [])
    .filter((v) => typeof v === 'string')
    .slice(0, 20);
  const profile_guitar_type = typeof payload.profile_guitar_type === 'string'
    ? payload.profile_guitar_type.slice(0, 60)
    : '';

  if (action !== 'query') {
    return json({ error: 'Unknown action' }, 400);
  }

  const signalLines: string[] = [];

  // ── 0. Weekly conversation topics (from community-digest cache) ──────────
  try {
    const { data: cached } = await supabase
      .from('community_signals_cache')
      .select('payload')
      .eq('signal_type', 'weekly_topics')
      .single();
    if (cached?.payload?.topics_text) {
      signalLines.push(cached.payload.topics_text as string);
    }
  } catch {
    // Non-fatal — no topics cached yet
  }

  // ── 1. Trending additions (last 30 days, opt-in users only) ─────────────
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Get IDs of users who have opted out
    const { data: optedOut } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('allow_activity_in_trends', false);
    const optedOutIds = (optedOut ?? []).map((r: { id: string }) => r.id);

    const trendingQuery = supabase
      .from('user_pedals')
      .select('pedal_id, pedal:pedals(brand, model)')
      .eq('status', 'owned')
      .gte('created_at', since);

    // Only exclude opted-out users if there are any
    const { data: trending } = optedOutIds.length > 0
      ? await trendingQuery.not('user_id', 'in', `(${optedOutIds.join(',')})`)
      : await trendingQuery;

    if (trending && trending.length > 0) {
      // Count by pedal_id in JS
      const counts = new Map<string, { brand: string; model: string; count: number }>();
      for (const row of trending) {
        const pid = row.pedal_id as string;
        const pedal = row.pedal as { brand: string; model: string } | null;
        if (!pedal) continue;
        const existing = counts.get(pid);
        if (existing) {
          existing.count++;
        } else {
          counts.set(pid, { brand: pedal.brand, model: pedal.model, count: 1 });
        }
      }
      const sorted = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
      if (sorted.length > 0) {
        const names = sorted.map(p => `${p.brand} ${p.model}`).join(', ');
        signalLines.push(`Trending this month: ${names}`);
      }
    }
  } catch {
    // Non-fatal — continue without this signal
  }

  // ── 2. Common pairings with user's collection ─────────────────────────────
  if (collection_pedal_ids.length > 0) {
    try {
      // Step A: find peer user IDs who own any pedal in the user's collection
      const { data: peerRows } = await supabase
        .from('user_pedals')
        .select('user_id')
        .in('pedal_id', collection_pedal_ids)
        .eq('status', 'owned');

      const peerUserIds = [...new Set((peerRows ?? []).map((r: { user_id: string }) => r.user_id))].slice(0, 100);

      if (peerUserIds.length > 0) {
        // Step B: find pedals those peers own that aren't in user's collection
        const { data: pairedRows } = await supabase
          .from('user_pedals')
          .select('pedal_id, pedal:pedals(brand, model)')
          .in('user_id', peerUserIds)
          .eq('status', 'owned')
          .not('pedal_id', 'in', `(${collection_pedal_ids.join(',')})`);

        if (pairedRows && pairedRows.length > 0) {
          const pairingCounts = new Map<string, { brand: string; model: string; count: number }>();
          for (const row of pairedRows) {
            const pid = row.pedal_id as string;
            const pedal = row.pedal as { brand: string; model: string } | null;
            if (!pedal) continue;
            const existing = pairingCounts.get(pid);
            if (existing) {
              existing.count++;
            } else {
              pairingCounts.set(pid, { brand: pedal.brand, model: pedal.model, count: 1 });
            }
          }
          const topPairings = [...pairingCounts.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
          if (topPairings.length > 0) {
            const names = topPairings.map(p => `${p.brand} ${p.model}`).join(', ');
            signalLines.push(`Pairs well with your collection: ${names}`);
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // ── 3. Wishlist pressure in user's gap categories ─────────────────────────
  if (gap_categories.length > 0) {
    try {
      const { data: wishlisted } = await supabase
        .from('user_pedals')
        .select('pedal_id, pedal:pedals(brand, model, category)')
        .eq('status', 'wishlist');

      if (wishlisted && wishlisted.length > 0) {
        const gapSet = new Set(gap_categories);
        const gapWishlist = wishlisted.filter((row) => {
          const pedal = row.pedal as { category?: string } | null;
          return pedal?.category && gapSet.has(pedal.category);
        });

        const wishCounts = new Map<string, { brand: string; model: string; count: number }>();
        for (const row of gapWishlist) {
          const pid = row.pedal_id as string;
          const pedal = row.pedal as { brand: string; model: string } | null;
          if (!pedal) continue;
          const existing = wishCounts.get(pid);
          if (existing) {
            existing.count++;
          } else {
            wishCounts.set(pid, { brand: pedal.brand, model: pedal.model, count: 1 });
          }
        }
        const topWish = [...wishCounts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
        if (topWish.length > 0) {
          const names = topWish.map(p => `${p.brand} ${p.model}`).join(', ');
          signalLines.push(`Most-wanted in your gaps: ${names}`);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // ── 4. Profile cluster — players with matching guitar type + genres ────────
  if (profile_guitar_type) {
    try {
      // Fetch users with matching guitar type
      const { data: clusterUsers } = await supabase
        .from('user_profiles')
        .select('id, pedal_expert_profile')
        .eq('pedal_expert_profile->>guitar_type' as string, profile_guitar_type);

      if (clusterUsers && clusterUsers.length > 0) {
        // Filter in JS for genre overlap
        const genreSet = new Set(profile_genres);
        const matchingUserIds = (clusterUsers as { id: string; pedal_expert_profile?: { genres?: string[] } }[])
          .filter(u => {
            const userGenres = u.pedal_expert_profile?.genres ?? [];
            return userGenres.some((g: string) => genreSet.has(g));
          })
          .map(u => u.id)
          .slice(0, 100);

        if (matchingUserIds.length > 0) {
          const idsToExclude = collection_pedal_ids.length > 0
            ? collection_pedal_ids
            : ['00000000-0000-0000-0000-000000000000']; // dummy to avoid empty IN

          const { data: clusterPedals } = await supabase
            .from('user_pedals')
            .select('pedal_id, pedal:pedals(brand, model)')
            .in('user_id', matchingUserIds)
            .eq('status', 'owned')
            .not('pedal_id', 'in', `(${idsToExclude.join(',')})`);

          if (clusterPedals && clusterPedals.length > 0) {
            const clusterCounts = new Map<string, { brand: string; model: string; count: number }>();
            for (const row of clusterPedals) {
              const pid = row.pedal_id as string;
              const pedal = row.pedal as { brand: string; model: string } | null;
              if (!pedal) continue;
              const existing = clusterCounts.get(pid);
              if (existing) {
                existing.count++;
              } else {
                clusterCounts.set(pid, { brand: pedal.brand, model: pedal.model, count: 1 });
              }
            }
            const topCluster = [...clusterCounts.values()]
              .sort((a, b) => b.count - a.count)
              .slice(0, 3);
            if (topCluster.length > 0) {
              const names = topCluster.map(p => `${p.brand} ${p.model}`).join(', ');
              signalLines.push(`Players like you gravitate toward: ${names}`);
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  const signals = signalLines.length > 0
    ? `COMMUNITY SIGNALS:\n${signalLines.map(l => `- ${l}`).join('\n')}`
    : '';

  return json({ signals });
});
