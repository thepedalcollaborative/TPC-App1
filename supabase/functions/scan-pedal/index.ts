// scan-pedal — Identifies a guitar pedal from a user photo using Claude vision.
// Returns { brand, model } as JSON. Kept intentionally minimal:
//   • No system prompt overhead — just the image + a tight instruction
//   • Sonnet 4.6 — meaningfully better pedal recognition than Haiku,
//     ~$0.008/scan at 1568px (image tokens ≈ w×h/750)
//
// Deploy: npx supabase functions deploy scan-pedal --no-verify-jwt
// Secret:  ANTHROPIC_API_KEY (shared with tpc-advisor)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Not configured.' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Auth check — require a logged-in user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Scan quota: 5 lifetime free scans, unlimited for Pro. Consumed atomically
    // BEFORE the Claude call so a denied request costs nothing.
    const { data: quotaData, error: quotaErr } = await userClient.rpc('consume_scan_quota', {
      p_user_id: user.id,
      p_free_allotment: 5,
    });
    if (quotaErr) {
      return new Response(
        JSON.stringify({ error: 'internal_error' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }
    const quota = Array.isArray(quotaData) ? quotaData[0] : quotaData;
    if (!quota?.allowed) {
      const status = quota?.error === 'pro_required' ? 403 : 401;
      return new Response(
        JSON.stringify({
          error: quota?.error ?? 'unauthorized',
          free_used: quota?.free_used ?? 5,
          free_allotment: quota?.free_allotment ?? 5,
        }),
        { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const { imageBase64, mediaType = 'image/jpeg' } = await req.json();
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'imageBase64 is required.' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            {
              type: 'text',
              text: `Identify the guitar effects pedal in this image. Reply with ONLY a JSON object, no other text:
{"brand":"...","model":"...","confidence":"high|medium|low"}

Rules:
- Use the canonical brand and model name (e.g. brand "Electro-Harmonix", model "Big Muff Pi" — not "EHX Big Muff Pi Fuzz")
- Do NOT repeat the brand inside the model field
- Do NOT append the effect type to the model name unless it is part of the official name
- If the label is partially obscured, identify by enclosure shape, color, knob layout, and graphics — give your best guess with "confidence":"low" rather than giving up
- If there is no guitar pedal in the image at all, use {"brand":"","model":"","confidence":"low"}
- If multiple pedals are visible, identify the most prominent/centered one`,
            },
          ],
        }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return new Response(
        JSON.stringify({ error: err }),
        { status: anthropicRes.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const data = await anthropicRes.json();
    const text = (data.content ?? []).find((b: { type: string }) => b.type === 'text')?.text ?? '';

    // Extract the first JSON object from the response
    const match = text.match(/\{[^}]+\}/);
    let parsed: { brand?: string; model?: string; confidence?: string } = {};
    try { parsed = match ? JSON.parse(match[0]) : {}; } catch { /* malformed JSON → empty result */ }

    return new Response(
      JSON.stringify({
        brand: parsed.brand ?? '',
        model: parsed.model ?? '',
        confidence: parsed.confidence ?? 'low',
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
