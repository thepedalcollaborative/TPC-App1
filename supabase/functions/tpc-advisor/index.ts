// TPC Advisor — proxies Claude API server-side so the API key never touches the client.
// Supports both streaming (SSE) and non-streaming responses.
//
// Model routing:
//   Advisor chat / quick analysis  → claude-haiku-4-5-20251001   (~15x cheaper)
//   Custom Shop final pick         → claude-sonnet-4-20250514     (premium quality)
//
// Prompt caching is enabled on the system prompt — large static context
// (GEAR_KNOWLEDGE_BASE + CATALOG_SUMMARY) is cached after the first call,
// saving ~90% on those tokens.
//
// Web search (optional, Pro-gated on the client):
//   Pass enableWebSearch: true to add Anthropic's built-in web_search_20250305
//   tool. Claude will search only when genuinely useful (price checks, current
//   availability, recent releases). Costs $0.01/search + token overhead.
//   Streaming is automatically disabled when tools are present.
//
// Agentic loop:
//   When Claude returns stop_reason: 'tool_use' (for custom tools), the function
//   loops — executing tool calls and feeding results back — until stop_reason is
//   'end_turn' or a max-iteration safety limit is hit.
//   For built-in server-side tools like web_search_20250305, Anthropic handles
//   execution internally and returns end_turn directly.
//
// Deploy: npx supabase functions deploy tpc-advisor --no-verify-jwt
// Secret:  npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Rate limiting is handled via the persistent check_rate_limit() RPC in Postgres.
// This survives cold starts and concurrent invocations unlike an in-memory Map.

// Per-purpose model whitelist. Chat and memory are locked to Haiku so a
// bypasser can't burn Sonnet tokens on the cheap quota; Custom Shop may use
// Sonnet for the final pick (its ticket is gated by consume_custom_shop_run).
const DEFAULT_MODEL = 'claude-haiku-4-5';
const MODELS_BY_PURPOSE: Record<string, Set<string>> = {
  chat:        new Set(['claude-haiku-4-5']),
  memory:      new Set(['claude-haiku-4-5']),
  custom_shop: new Set(['claude-haiku-4-5', 'claude-sonnet-4-5']),
};

// Built-in Anthropic web search tool (server-side — Anthropic executes the search)
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
};

// Custom tool: server-side URL fetch so Claude can read pages the user pastes
const FETCH_URL_TOOL = {
  name: 'fetch_url',
  description: 'Fetches and returns the text content of a public web page. Use this whenever the user shares or mentions a URL and wants you to read, summarize, or discuss its contents. Do NOT use this for general searches — use web_search for that.',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The full URL to fetch (must be a public https:// address).',
      },
    },
    required: ['url'],
  },
};

// SSRF protection — block private/loopback/link-local addresses
function isSafeUrl(urlStr: string): boolean {
  let url: URL;
  try { url = new URL(urlStr); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const h = url.hostname.toLowerCase();
  return ![
    /^localhost$/i, /^127\./, /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
    /^169\.254\./, /^0\.0\.0\.0$/, /\.local$/i,
    /\.internal$/i, /^::1$/,
  ].some(r => r.test(h));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}

async function fetchUrlContent(url: string): Promise<string> {
  if (!isSafeUrl(url)) return 'Error: URL must be a public https:// address.';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TPC-Advisor/1.0', Accept: 'text/html,text/plain;q=0.9' },
    });
    clearTimeout(timer);
    if (!res.ok) return `Error: Page returned HTTP ${res.status}.`;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html') && !ct.includes('text') && !ct.includes('json')) {
      return 'Error: URL does not point to readable text content.';
    }
    const raw = await res.text();
    const text = ct.includes('html') ? stripHtml(raw.slice(0, 200_000)) : raw.slice(0, 200_000);
    return text.slice(0, 5000) || 'Error: Page appears to be empty.';
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'Error: Request timed out after 8s.';
    return `Error: Could not fetch URL — ${(e as Error).message}`;
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Extract the first text block from a content array
function extractText(content: { type: string; text?: string }[]): string {
  return content?.find(b => b.type === 'text')?.text ?? '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const {
      messages,
      systemPrompt,
      stream = true,
      tools: clientTools,
      maxTokens,
      model: requestedModel,
      enableWebSearch = false,
      purpose: requestedPurpose,
      ticket,
    } = await req.json();

    // Untrusted client input — anything unrecognized is treated as chat,
    // which carries the strictest quota.
    const purpose: 'chat' | 'custom_shop' | 'memory' =
      requestedPurpose === 'custom_shop' || requestedPurpose === 'memory'
        ? requestedPurpose
        : 'chat';

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Advisor is not configured.' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Server auth is not configured.' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

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

    // ── Input validation ──────────────────────────────────────────────────────
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid messages payload.' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }
    const totalChars = messages.reduce((sum: number, m: { content?: unknown }) =>
      sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
    if (totalChars > 12000) {
      return new Response(
        JSON.stringify({ error: 'Conversation payload too large.' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // ── Admin client (service-role) ───────────────────────────────────────────
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ── Rate limit check (persistent — survives cold starts) ──────────────────
    // Limit: 30 requests per 60-second window per user.
    const { data: allowed, error: rlErr } = await adminClient.rpc('check_rate_limit', {
      p_user_id:        user.id,
      p_endpoint:       'tpc-advisor',
      p_limit:          30,
      p_window_seconds: 60,
    });
    if (rlErr) {
      console.error('[tpc-advisor] rate limit check error:', rlErr.message);
    } else if (!allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment before sending more messages.' }),
        { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // ── Quota enforcement (server-side, per purpose) ──────────────────────────
    // Consumed BEFORE the Anthropic call so denied requests cost nothing.
    // quotaInfo is attached to non-streaming chat responses for the counter UI.
    let quotaInfo: Record<string, unknown> | null = null;
    let isProUser = false;

    if (purpose === 'chat') {
      const { data: qData, error: qErr } = await userClient.rpc('consume_ai_message_quota', {
        p_user_id: user.id,
      });
      if (qErr) {
        console.error('[tpc-advisor] quota RPC error:', qErr.message);
        return new Response(
          JSON.stringify({ error: 'internal_error' }),
          { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      const q = Array.isArray(qData) ? qData[0] : qData;
      if (!q?.allowed) {
        if (q?.error === 'pro_required') {
          return new Response(
            JSON.stringify({ error: 'pro_required', free_used: q.free_used ?? 3, free_allotment: q.free_allotment ?? 3 }),
            { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }
        if (q?.error === 'messages_depleted') {
          return new Response(
            JSON.stringify({ error: 'messages_depleted', credits: q.credits ?? 0 }),
            { status: 402, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ error: q?.error ?? 'unauthorized' }),
          { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      // Free-tier rows carry free_used; Pro rows carry used/allotment.
      isProUser = q.free_used == null;
      quotaInfo = {
        used: q.used, allotment: q.allotment, credits: q.credits,
        used_credit: q.used_credit, free_used: q.free_used, free_allotment: q.free_allotment,
      };
    } else if (purpose === 'custom_shop') {
      // Ticket issued by custom-shop-gate after consume_custom_shop_run.
      // Without a valid ticket the purpose claim is worthless.
      if (!ticket || typeof ticket !== 'string') {
        return new Response(
          JSON.stringify({ error: 'invalid_ticket' }),
          { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      const adminForTicket = createClient(supabaseUrl, serviceRoleKey);
      const { data: ok, error: tErr } = await adminForTicket.rpc('consume_custom_shop_ticket', {
        p_ticket: ticket,
        p_user_id: user.id,
      });
      if (tErr || !ok) {
        return new Response(
          JSON.stringify({ error: 'invalid_ticket' }),
          { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      isProUser = true; // run quota already validated Pro/free-run status
    } else {
      // memory: Pro-only background summarization, Haiku, small output.
      const adminForProfile = createClient(supabaseUrl, serviceRoleKey);
      const { data: profileRow } = await adminForProfile
        .from('user_profiles')
        .select('is_premium')
        .eq('id', user.id)
        .single();
      if (!profileRow?.is_premium) {
        return new Response(
          JSON.stringify({ error: 'pro_required' }),
          { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      isProUser = true;
    }

    // Web search costs $0.01/search — Pro (or ticketed Custom Shop) only,
    // and never for memory summarization.
    const allowWebSearch = Boolean(enableWebSearch) && purpose !== 'memory' && isProUser;

    // ── Dynamic data injection (parallel fetches) ────────────────────────────
    // Three blocks assembled here and injected after the cached system prompt:
    //   1. recentPedalsFeed  — Reverb market data (trending/pricing awareness)
    //   2. tpcCatalogBlock   — TPC's own pedal catalog (filtered to user's categories)
    //   3. tpcCommunityBlock — Anonymized user behavior signals with min-threshold

    let recentPedalsFeed = '';
    let tpcCatalogBlock = '';
    let tpcCommunityBlock = '';

    try {
      const [recentPedalsRes, userPedalsRes, userCountRes] = await Promise.all([
        adminClient
          .from('recent_pedals')
          .select('brand, model, category, avg_price, listing_count')
          .gt('last_seen_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())
          .order('listing_count', { ascending: false })
          .limit(40),
        adminClient
          .from('user_pedals')
          .select('pedal_id, pedals(category)')
          .eq('user_id', user.id)
          .in('status', ['owned', 'wishlist'])
          .limit(100),
        adminClient
          .from('user_profiles')
          .select('id', { count: 'exact', head: true }),
      ]);

      // 1. Reverb feed
      if (recentPedalsRes.data && recentPedalsRes.data.length > 0) {
        const lines = recentPedalsRes.data.map((p: {
          brand: string; model: string; category: string | null;
          avg_price: number | null; listing_count: number;
        }) => {
          const price = p.avg_price ? ` ~$${p.avg_price}` : '';
          const cat = p.category ? ` [${p.category}]` : '';
          return `• ${p.brand} ${p.model}${cat}${price} (${p.listing_count} listings)`;
        }).join('\n');
        recentPedalsFeed = `\n\nRECENTLY ACTIVE ON REVERB (last 60 days — use this for current awareness):\n${lines}`;
      }

      // 2. TPC catalog — the user's own pedals FIRST (guaranteed, never crowded
      // out of the window), then other catalog pedals in their categories.
      // Previously a flat 60-pedal window could omit a pedal the user owns —
      // the advisor then had no manual_text for the exact pedal being asked about.
      const rawCats = (userPedalsRes.data ?? [])
        .map((row: { pedals: { category: string } | null }) => row.pedals?.category)
        .filter(Boolean) as string[];
      const userCategories = [...new Set(rawCats)];
      const userPedalIds = [...new Set(
        (userPedalsRes.data ?? [])
          .map((row: { pedal_id: string | null }) => row.pedal_id)
          .filter(Boolean) as string[]
      )];

      const CATALOG_COLUMNS = [
        'id', 'brand', 'model', 'category', 'subcategory', 'version_label',
        'tone_dna', 'manual_text', 'price_usd', 'in_production', 'analog',
        'true_bypass', 'midi', 'midi_notes', 'presets', 'preset_count',
        'power_requirements', 'mono_stereo', 'dimensions',
        'manual_url', 'midi_manual_url', 'quick_start_url',
        'is_verified',
      ].join(', ');

      const fillQuery = adminClient
        .from('pedals')
        .select(CATALOG_COLUMNS)
        .is('merged_into', null)
        .order('is_verified', { ascending: false })
        .order('imported_at', { ascending: false, nullsFirst: false })
        .limit(60);
      if (userCategories.length > 0) {
        fillQuery.in('category', userCategories);
      }

      const [ownedCatalogRes, fillCatalogRes] = await Promise.all([
        userPedalIds.length > 0
          ? adminClient.from('pedals').select(CATALOG_COLUMNS).in('id', userPedalIds)
          : Promise.resolve({ data: [] }),
        fillQuery,
      ]);

      const ownedRows = ownedCatalogRes.data ?? [];
      const ownedIdSet = new Set(ownedRows.map((p: { id: string }) => p.id));
      const fillRows = (fillCatalogRes.data ?? [])
        .filter((p: { id: string }) => !ownedIdSet.has(p.id))
        .slice(0, Math.max(0, 60 - ownedRows.length));
      const catalogPedals = [...ownedRows, ...fillRows];
      // Owned pedals get fuller manual notes — questions are usually about them
      const ownedManualCap = 2000;

      if (catalogPedals && catalogPedals.length > 0) {
        const lines = catalogPedals.map((p: {
          id: string;
          brand: string; model: string; category: string | null;
          subcategory: string | null; version_label: string | null;
          tone_dna: string | null; manual_text: string | null; price_usd: number | null;
          in_production: boolean | null; analog: boolean | null;
          true_bypass: boolean | null; midi: boolean | null;
          midi_notes: string | null; presets: boolean | null;
          preset_count: number | null; power_requirements: string | null;
          mono_stereo: string | null; dimensions: string | null;
          manual_url: string | null; midi_manual_url: string | null;
          quick_start_url: string | null; is_verified: boolean | null;
        }) => {
          const cat = [p.category, p.subcategory].filter(Boolean).join('/');
          const version = p.version_label ? ` ${p.version_label}` : '';
          const verified = p.is_verified ? ' [TPC VERIFIED]' : '';
          const owned = ownedIdSet.has(p.id) ? " [IN USER'S VAULT]" : '';
          const price = p.price_usd ? ` $${p.price_usd}` : '';
          const flags = [
            p.analog === true ? 'analog' : p.analog === false ? 'digital' : null,
            p.in_production === false ? 'discontinued' : null,
            p.true_bypass ? 'true bypass' : null,
            p.mono_stereo ? p.mono_stereo.replace(/_/g, ' ') : null,
            p.midi ? (p.midi_notes ? `MIDI (${p.midi_notes})` : 'MIDI') : null,
            p.presets && p.preset_count ? `${p.preset_count} presets` : p.presets ? 'presets' : null,
          ].filter(Boolean).join(', ');
          const flagStr = flags ? ` (${flags})` : '';
          const power = p.power_requirements ? ` | Power: ${p.power_requirements}` : '';
          const dims = p.dimensions ? ` | Size: ${p.dimensions}` : '';
          const dna = p.tone_dna ? `\n  Sound: ${p.tone_dna}` : '';
          const manualCap = ownedIdSet.has(p.id) ? ownedManualCap : 800;
          const manualSnippet = p.manual_text ? `\n  Manual notes: ${p.manual_text.slice(0, manualCap)}${p.manual_text.length > manualCap ? '…' : ''}` : '';
          const docs = [
            p.manual_url ? `manual: ${p.manual_url}` : null,
            p.midi_manual_url ? `MIDI manual: ${p.midi_manual_url}` : null,
            p.quick_start_url ? `quick start: ${p.quick_start_url}` : null,
          ].filter(Boolean).join(', ');
          const docsStr = docs ? `\n  Docs: ${docs}` : '';
          return `• ${p.brand} ${p.model}${version}${verified}${owned} [${cat}]${price}${flagStr}${power}${dims}${dna}${manualSnippet}${docsStr}`;
        }).join('\n');
        tpcCatalogBlock = `\n\nTPC PEDAL CATALOG (verified entries are TPC admin-confirmed; use manual URLs with fetch_url when a user asks about MIDI, specs, or setup for a specific pedal):\n${lines}`;
      }

      // 3. Community signals — minimum threshold before surfacing any signal
      const userCount = userCountRes.count ?? 0;
      const threshold = userCount >= 50 ? Math.ceil(userCount * 0.10) : 3;

      const { data: signals } = await adminClient
        .from('tpc_community_signals')
        .select('brand, model, recent_acquisitions, wishlist_count, total_owners')
        .or(`recent_acquisitions.gte.${threshold},wishlist_count.gte.${threshold}`)
        .order('recent_acquisitions', { ascending: false })
        .limit(15);

      if (signals && signals.length > 0) {
        const lines = signals.map((s: {
          brand: string; model: string;
          recent_acquisitions: number; wishlist_count: number; total_owners: number;
        }) => {
          const parts: string[] = [];
          if (s.recent_acquisitions >= threshold) {
            parts.push(`${s.recent_acquisitions} TPC member${s.recent_acquisitions !== 1 ? 's' : ''} added this month`);
          }
          if (s.wishlist_count >= threshold) {
            parts.push(`${s.wishlist_count} have it on their wishlist`);
          }
          return `• ${s.brand} ${s.model} — ${parts.join('; ')} (${s.total_owners} total owners in TPC)`;
        }).join('\n');
        tpcCommunityBlock = `\n\nTPC COMMUNITY SIGNALS (anonymized — only shown when ${threshold}+ members agree):\n${lines}`;
      }

    } catch (e) {
      console.warn('[tpc-advisor] data injection failed:', (e as Error).message);
    }

    const model = (requestedModel && MODELS_BY_PURPOSE[purpose].has(requestedModel))
      ? requestedModel
      : DEFAULT_MODEL;

    // Memory summarization never needs long output — hard cap regardless of
    // what the client requested.
    const effectiveMaxTokens = purpose === 'memory'
      ? Math.min(maxTokens ?? 1024, 1024)
      : maxTokens;

    // Merge client-supplied tools with custom and built-in tools
    const allTools = [
      ...(clientTools ?? []),
      FETCH_URL_TOOL,
      ...(allowWebSearch ? [WEB_SEARCH_TOOL] : []),
    ];
    const hasTools = allTools.length > 0;

    // Don't stream when tools are present — full body needed for tool responses
    const shouldStream = stream && !hasTools;

    // Wrap system prompt in a caching block. Static context is cached;
    // all dynamic blocks (Reverb feed, TPC catalog, community signals) are
    // appended after the cache boundary so they're always fresh.
    const dynamicSuffix = recentPedalsFeed + tpcCatalogBlock + tpcCommunityBlock;
    const systemBlock = systemPrompt
      ? [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
          ...(dynamicSuffix ? [{ type: 'text', text: dynamicSuffix }] : []),
        ]
      : undefined;

    // Beta flags: always enable prompt caching; add web search when needed
    const betaFlags = ['prompt-caching-2024-07-31'];
    if (allowWebSearch) betaFlags.push('web-search-2025-03-05');

    // ── Agentic loop ───────────────────────────────────────────────────────────
    // For built-in server-side tools (web_search_20250305), Anthropic handles
    // execution internally and returns end_turn. We still loop for custom tools
    // and as a safety net. Max 6 iterations to prevent runaway costs.

    let currentMessages = messages;
    const MAX_ITERATIONS = 6;
    let finalContent: { type: string; text?: string }[] = [];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const requestBody: Record<string, unknown> = {
        model,
        max_tokens: effectiveMaxTokens ?? (hasTools ? 4096 : 1024),
        stream: shouldStream && i === 0, // only stream on first iteration, tools kill it anyway
        messages: currentMessages,
      };
      if (systemBlock) requestBody.system = systemBlock;
      if (hasTools) requestBody.tools = allTools;

      const anthropicRes = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': betaFlags.join(','),
        },
        body: JSON.stringify(requestBody),
      });

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        return new Response(
          JSON.stringify({ error: errText }),
          { status: anthropicRes.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      // First iteration with streaming — pipe SSE directly back to client
      if (shouldStream && i === 0) {
        return new Response(anthropicRes.body, {
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        });
      }

      const data = await anthropicRes.json();
      finalContent = data.content ?? [];

      // Done — return final response
      if (data.stop_reason === 'end_turn' || data.stop_reason === 'stop_sequence') {
        break;
      }

      // Tool use — build tool_result messages and continue
      if (data.stop_reason === 'tool_use') {
        const toolUseBlocks = finalContent.filter(b => b.type === 'tool_use') as {
          type: string; id: string; name: string; input: unknown;
        }[];

        if (toolUseBlocks.length === 0) break;

        // Append assistant's response to the conversation
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: finalContent },
        ];

        // Execute custom tools; for built-in server-side tools (web_search_20250305),
        // Anthropic handles execution internally so we shouldn't normally reach here.
        const toolResults = await Promise.all(toolUseBlocks.map(async block => {
          let content: string;
          if (block.name === 'fetch_url') {
            const { url } = block.input as { url?: string };
            content = url ? await fetchUrlContent(url) : 'Error: No URL provided.';
          } else {
            content = 'Tool execution completed.';
          }
          return { type: 'tool_result', tool_use_id: block.id, content };
        }));

        currentMessages = [
          ...currentMessages,
          { role: 'user', content: toolResults },
        ];

        continue;
      }

      // Any other stop reason — return what we have
      break;
    }

    return new Response(
      JSON.stringify({ content: finalContent, ...(quotaInfo ? { quota: quotaInfo } : {}) }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
