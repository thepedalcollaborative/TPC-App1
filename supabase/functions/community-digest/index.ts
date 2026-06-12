/**
 * community-digest — weekly summary job.
 *
 * Runs on a schedule (see migration below). Does two things:
 *   1. Analyzes the past week's AI Advisor conversations using Haiku,
 *      extracts the top topics, and stores them in community_signals_cache
 *      so TPC.ai can inject them into every session.
 *   2. Sends an admin email via Resend summarizing app activity.
 *
 * Required Supabase secrets:
 *   RESEND_API_KEY     — from resend.com
 *   ADMIN_EMAIL        — where to send the digest (e.g. you@thepedalcollaborative.com)
 *   ANTHROPIC_API_KEY  — for topic extraction via Haiku
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-set
 *
 * Deploy:
 *   npx supabase functions deploy community-digest --no-verify-jwt
 *
 * Schedule (add to a migration after deploying):
 *   SELECT cron.schedule(
 *     'community-digest-weekly',
 *     '0 9 * * 1',   -- every Monday at 9am UTC
 *     $$
 *       SELECT net.http_post(
 *         url := current_setting('app.supabase_url') || '/functions/v1/community-digest',
 *         headers := jsonb_build_object(
 *           'Content-Type', 'application/json',
 *           'Authorization', 'Bearer ' || current_setting('app.service_role_key')
 *         ),
 *         body := '{}'::jsonb
 *       );
 *     $$
 *   );
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY') ?? '';
const ADMIN_EMAIL       = Deno.env.get('ADMIN_EMAIL') ?? '';
const APP_NAME          = 'The Pedal Collaborative';
const FROM_EMAIL        = 'noreply@thepedalcollaborative.com';
const HAIKU             = 'claude-haiku-4-5-20251001';

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

// ─── ISO week key (same logic as weekly-pick) ─────────────────────────────────
function getWeekKey(): string {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─── Extract topics from conversations using Haiku ───────────────────────────
async function extractTopics(conversationSamples: string[]): Promise<string> {
  if (conversationSamples.length === 0) return 'No conversations this week.';

  // Truncate each sample to keep token cost low
  const truncated = conversationSamples
    .slice(0, 40)
    .map(s => s.slice(0, 300))
    .join('\n---\n');

  const prompt = `You are summarizing what guitarists asked a music gear AI this week.

Here are samples from user messages (truncated):
${truncated}

Return ONLY a JSON object:
{
  "topics": ["topic 1", "topic 2", ...],   // 5–8 short topic labels, most common first
  "summary": "1–2 sentence plain-English summary of the week's conversations"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: HAIKU,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) return 'Topic extraction unavailable.';

  const data = await res.json();
  const raw = data.content?.[0]?.text ?? '';
  try {
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return `Topics members asked about this week: ${(parsed.topics as string[]).join(', ')}. ${parsed.summary}`;
  } catch {
    return raw.slice(0, 300);
  }
}

// ─── Send admin email via Resend ─────────────────────────────────────────────
async function sendAdminEmail(html: string, subject: string): Promise<void> {
  if (!RESEND_API_KEY || !ADMIN_EMAIL) {
    console.warn('[community-digest] RESEND_API_KEY or ADMIN_EMAIL not set — skipping email');
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      to: [ADMIN_EMAIL],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[community-digest] Resend error:', err);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Accept calls from pg_cron (no user JWT) or a manual trigger with service key
  const authHeader = req.headers.get('Authorization') ?? '';
  const isServiceRole = authHeader.includes(SERVICE_ROLE_KEY);
  const isCron = req.headers.get('x-supabase-cron') === '1';
  if (!isServiceRole && !isCron) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weekKey = getWeekKey();

    // ── 1. Gather conversation stats ─────────────────────────────────────────
    const { data: convRows } = await admin
      .from('conversations')
      .select('user_id, messages, updated_at')
      .gte('updated_at', weekAgo);

    const conversations = convRows ?? [];
    const uniqueUsers = new Set(conversations.map((c: { user_id: string }) => c.user_id)).size;
    const totalConvs = conversations.length;

    // Extract only user messages for topic analysis
    const userMessages: string[] = [];
    for (const conv of conversations) {
      const msgs = (conv as { messages: { role: string; content: string }[] }).messages ?? [];
      for (const m of msgs) {
        if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
          userMessages.push(m.content.trim());
        }
      }
    }

    // ── 2. AI message gate stats ──────────────────────────────────────────────
    const { count: totalAiMessages } = await admin
      .from('ai_message_usage')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo);

    // ── 3. New users this week ────────────────────────────────────────────────
    const { count: newUsers } = await admin
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo);

    // ── 4. Vault/wishlist activity ────────────────────────────────────────────
    const { count: newPedalsAdded } = await admin
      .from('user_pedals')
      .select('*', { count: 'exact', head: true })
      .in('status', ['owned', 'wishlist'])
      .gte('created_at', weekAgo);

    // ── 5. Trending pedals (most added this week) ─────────────────────────────
    const { data: trendingRows } = await admin
      .from('user_pedals')
      .select('pedal_id, pedal:pedals(brand, model)')
      .in('status', ['owned', 'wishlist'])
      .gte('created_at', weekAgo);

    const trendCounts = new Map<string, { brand: string; model: string; count: number }>();
    for (const row of (trendingRows ?? [])) {
      const pedal = (row as { pedal: { brand: string; model: string } | null }).pedal;
      if (!pedal) continue;
      const key = `${pedal.brand}|${pedal.model}`;
      const existing = trendCounts.get(key);
      trendCounts.set(key, { brand: pedal.brand, model: pedal.model, count: (existing?.count ?? 0) + 1 });
    }
    const topTrending = [...trendCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ── 6. Extract conversation topics via Haiku ──────────────────────────────
    const topicsText = await extractTopics(userMessages);

    // ── 7. Store topics in community_signals_cache ────────────────────────────
    await admin
      .from('community_signals_cache')
      .upsert(
        {
          signal_type: 'weekly_topics',
          payload: { topics_text: topicsText, week_key: weekKey },
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'signal_type' },
      );

    // ── 8. Build and send admin email ─────────────────────────────────────────
    const trendingHtml = topTrending.length > 0
      ? topTrending.map(p => `<li><strong>${p.brand} ${p.model}</strong> — ${p.count} add${p.count === 1 ? '' : 's'}</li>`).join('\n')
      : '<li>Not enough data yet</li>';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, sans-serif; color: #3D5261; max-width: 600px; margin: 0 auto; padding: 24px; }
    h1 { color: #2D8A7E; font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 15px; color: #3D5261; margin: 24px 0 8px; border-bottom: 1px solid #E2DDD7; padding-bottom: 6px; }
    .stat { display: inline-block; background: #F7F4F0; border-radius: 8px; padding: 12px 20px; margin: 6px 6px 6px 0; text-align: center; }
    .stat-number { font-size: 28px; font-weight: 700; color: #2D8A7E; display: block; }
    .stat-label { font-size: 12px; color: #8FA3AE; }
    ul { padding-left: 20px; }
    li { margin-bottom: 6px; font-size: 14px; }
    .topics { background: #F7F4F0; border-radius: 8px; padding: 14px 16px; font-size: 14px; line-height: 1.6; }
    .footer { margin-top: 32px; font-size: 12px; color: #8FA3AE; border-top: 1px solid #E2DDD7; padding-top: 16px; }
  </style>
</head>
<body>
  <h1>📊 TPC Weekly Digest</h1>
  <p style="color:#8FA3AE; font-size:13px; margin-top:0;">Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>

  <h2>App Activity</h2>
  <div>
    <div class="stat"><span class="stat-number">${newUsers ?? 0}</span><span class="stat-label">New Users</span></div>
    <div class="stat"><span class="stat-number">${uniqueUsers}</span><span class="stat-label">Active in AI</span></div>
    <div class="stat"><span class="stat-number">${totalConvs}</span><span class="stat-label">Conversations</span></div>
    <div class="stat"><span class="stat-number">${totalAiMessages ?? 0}</span><span class="stat-label">AI Messages</span></div>
    <div class="stat"><span class="stat-number">${newPedalsAdded ?? 0}</span><span class="stat-label">Pedals Added</span></div>
  </div>

  <h2>What Members Asked TPC.ai</h2>
  <div class="topics">${topicsText}</div>

  <h2>Trending Pedals This Week</h2>
  <ul>${trendingHtml}</ul>

  <div class="footer">
    Sent automatically every Monday · <a href="https://supabase.com/dashboard/project/skejiotfywhmnvsivfsk" style="color:#2D8A7E;">Supabase Dashboard</a>
  </div>
</body>
</html>`;

    await sendAdminEmail(html, `TPC Weekly Digest — ${weekKey}`);

    return json({
      ok: true,
      weekKey,
      stats: { newUsers, uniqueUsers, totalConvs, totalAiMessages, newPedalsAdded },
      topTrending,
      topicsStored: true,
    });

  } catch (e) {
    console.error('[community-digest] Error:', (e as Error).message);
    return json({ error: 'Internal server error' }, 500);
  }
});
