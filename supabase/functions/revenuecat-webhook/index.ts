/**
 * revenuecat-webhook
 *
 * Receives RevenueCat server-to-server events and keeps user_profiles.is_premium
 * in sync. Set this URL in RevenueCat dashboard → Integrations → Webhooks.
 *
 * Required Supabase secrets:
 *   REVENUECAT_WEBHOOK_SECRET  — Authorization header value set in RC dashboard
 *   SUPABASE_URL               — auto-provided
 *   SUPABASE_SERVICE_ROLE_KEY  — auto-provided
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ACTIVE_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
]);

const INACTIVE_EVENTS = new Set([
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'SUBSCRIBER_ALIAS',
]);

Deno.serve(async (req) => {
  // ── Auth ───────────────────────────────────────────────────────────────────
  // Reject everything if the secret isn't configured — an unauthenticated webhook
  // endpoint that can write is_premium is a critical vulnerability.
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
  if (!secret) {
    console.warn('[revenuecat-webhook] REVENUECAT_WEBHOOK_SECRET not set — rejecting request');
    return new Response('Webhook not configured', { status: 503 });
  }
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  // ── Parse ──────────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const event = body.event as Record<string, unknown> | undefined;
  if (!event) return new Response('No event', { status: 400 });

  const eventType = event.type as string;
  const appUserId = event.app_user_id as string | undefined;

  if (!appUserId) return new Response('No app_user_id', { status: 400 });

  // ── Determine pro status ───────────────────────────────────────────────────
  let isPremium: boolean | null = null;
  let proSource: string | null = null;

  if (ACTIVE_EVENTS.has(eventType)) {
    isPremium = true;
    proSource = 'apple'; // RC handles Apple IAP; adjust if adding Google Play
  } else if (INACTIVE_EVENTS.has(eventType)) {
    isPremium = false;
    proSource = null;
  }

  // Unknown event type — acknowledge but do nothing
  if (isPremium === null) {
    return new Response(JSON.stringify({ received: true, action: 'ignored' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Update Supabase ────────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // On purchase/renewal: reset message count and set next allotment date.
  // On cancellation/expiry: just flip is_premium — keep the count as-is.
  const nextResetAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const extraFields = isPremium
    ? { ai_messages_used: 0, ai_allotment_reset_at: nextResetAt }
    : {};

  const { error } = await supabase
    .from('user_profiles')
    .update({ is_premium: isPremium, pro_source: proSource, ...extraFields })
    .eq('id', appUserId);

  if (error) {
    console.error('[revenuecat-webhook] Supabase update error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`[revenuecat-webhook] ${eventType} processed → is_premium=${isPremium}`);

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
