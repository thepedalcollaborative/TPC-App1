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

// Whitelist prevents clients from requesting arbitrary models
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
]);
const DEFAULT_MODEL = 'claude-haiku-4-5';

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
    } = await req.json();

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

    const allowWebSearch = Boolean(enableWebSearch);

    // ── Recent pedals feed ────────────────────────────────────────────────────
    // Inject a compact "recently trending" block into the system prompt so
    // Claude has real-time awareness of new gear without burning a search call.
    let recentPedalsFeed = '';
    try {
      const { data: recentPedals } = await adminClient
        .from('recent_pedals')
        .select('brand, model, category, avg_price, listing_count')
        .gt('last_seen_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())
        .order('listing_count', { ascending: false })
        .limit(40);

      if (recentPedals && recentPedals.length > 0) {
        const lines = recentPedals.map((p: {
          brand: string; model: string; category: string | null;
          avg_price: number | null; listing_count: number;
        }) => {
          const price = p.avg_price ? ` ~$${p.avg_price}` : '';
          const cat = p.category ? ` [${p.category}]` : '';
          return `• ${p.brand} ${p.model}${cat}${price} (${p.listing_count} listings)`;
        }).join('\n');
        recentPedalsFeed = `\n\nRECENTLY ACTIVE ON REVERB (last 60 days — use this for current awareness):\n${lines}`;
      }
    } catch (e) {
      console.warn('[tpc-advisor] recent_pedals fetch failed:', (e as Error).message);
    }

    const model = (requestedModel && ALLOWED_MODELS.has(requestedModel))
      ? requestedModel
      : DEFAULT_MODEL;

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
    // the small dynamic recentPedalsFeed suffix is appended outside the cache.
    const systemBlock = systemPrompt
      ? [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
          ...(recentPedalsFeed ? [{ type: 'text', text: recentPedalsFeed }] : []),
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
        max_tokens: maxTokens ?? (hasTools ? 4096 : 1024),
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
      JSON.stringify({ content: finalContent }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
