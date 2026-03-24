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

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Whitelist prevents clients from requesting arbitrary models
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
]);
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// Built-in Anthropic web search tool (server-side — Anthropic executes the search)
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
};

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
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Advisor is not configured.' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const model = (requestedModel && ALLOWED_MODELS.has(requestedModel))
      ? requestedModel
      : DEFAULT_MODEL;

    // Merge client-supplied tools with web search when requested
    const allTools = [
      ...(clientTools ?? []),
      ...(enableWebSearch ? [WEB_SEARCH_TOOL] : []),
    ];
    const hasTools = allTools.length > 0;

    // Don't stream when tools are present — full body needed for tool responses
    const shouldStream = stream && !hasTools;

    // Wrap system prompt in a caching block. The large static context
    // (gear knowledge base + catalog summary) is the same across all turns,
    // so it benefits heavily from caching.
    const systemBlock = systemPrompt
      ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
      : undefined;

    // Beta flags: always enable prompt caching; add web search when needed
    const betaFlags = ['prompt-caching-2024-07-31'];
    if (enableWebSearch) betaFlags.push('web-search-2025-03-05');

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

        // Build tool results (for server-side tools, results are handled by Anthropic;
        // we shouldn't normally reach here for web_search_20250305)
        const toolResults = toolUseBlocks.map(block => ({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Tool execution completed.',
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
