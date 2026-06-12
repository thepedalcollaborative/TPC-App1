// Anthropic API client — all requests are proxied through the tpc-advisor edge function.
// The API key lives in Supabase secrets and never touches the client.

import Constants from 'expo-constants';
import { getEdgeAuthHeaders } from './supabase';

const extra =
  Constants.expoConfig?.extra ??
  (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra ??
  (Constants as unknown as { expoGoConfig?: { extra?: Record<string, unknown> } }).expoGoConfig?.extra ??
  {};

const supabaseUrl = (extra.supabaseUrl as string) ?? '';
const ADVISOR_URL = `${supabaseUrl}/functions/v1/tpc-advisor`;

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export type Message = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
};

export type QuotaInfo = {
  used?: number | null;
  allotment?: number | null;
  credits?: number | null;
  used_credit?: boolean | null;
  free_used?: number | null;
  free_allotment?: number | null;
};

export type StreamChunk = {
  type: 'text' | 'done' | 'error';
  text?: string;
  error?: string;
  /** Gate rejection from the server — drives paywall vs. retry UX */
  code?: 'pro_required' | 'messages_depleted';
  /** Present on 'done' chunks for chat calls — drives the message counter */
  quota?: QuotaInfo;
};

export type AskOptions = {
  /** Pass true for Pro users — lets Claude search the web for price/availability/recent releases */
  enableWebSearch?: boolean;
  /** Override the default Haiku model */
  model?: string;
  maxTokens?: number;
  /** Quota path on the server: 'chat' (message quota), 'custom_shop' (run ticket), 'memory' (Pro-only) */
  purpose?: 'chat' | 'custom_shop' | 'memory';
  /** Single-run ticket from custom-shop-gate — required when purpose is 'custom_shop' */
  ticket?: string;
};

// Haiku: Advisor chat and quick analysis calls (~15x cheaper than Sonnet)
// Sonnet: Custom Shop final recommendation (premium quality, explicit opt-in)
const HAIKU = 'claude-haiku-4-5';

/** Extract text from all text blocks — handles mixed tool_use + text responses */
function extractTextFromContent(content: { type: string; text?: string }[]): string {
  return (content ?? [])
    .filter(c => c.type === 'text' && typeof c.text === 'string' && c.text.trim().length > 0)
    .map(c => c.text!.trim())
    .join('\n\n');
}

/**
 * Send messages to Claude and get a response via the tpc-advisor edge function.
 * Non-streaming — returns the full response as a single text chunk.
 */
const MAX_MESSAGE_CHARS = 2000;
const MAX_CONVERSATION_CHARS = 12000;

export async function askClaude(
  messages: Message[],
  systemPrompt: string,
  onChunk: (chunk: StreamChunk) => void,
  options: AskOptions = {}
): Promise<void> {
  // Guard against oversized payloads that could cause runaway API costs.
  // Image messages skip the single-message char limit (the image is the payload).
  const lastMessage = messages[messages.length - 1];
  const hasImage = Array.isArray(lastMessage?.content) &&
    (lastMessage.content as ContentBlock[]).some(b => b.type === 'image');
  if (!hasImage && lastMessage && typeof lastMessage.content === 'string' &&
      lastMessage.content.length > MAX_MESSAGE_CHARS) {
    onChunk({ type: 'error', error: `Message too long (max ${MAX_MESSAGE_CHARS} characters).` });
    return;
  }
  const countTextChars = (m: Message) => {
    if (typeof m.content === 'string') return m.content.length;
    return (m.content as ContentBlock[]).reduce((s, b) =>
      s + (b.type === 'text' ? b.text.length : 0), 0);
  };
  const totalChars = messages.reduce((sum, m) => sum + countTextChars(m), 0);
  if (totalChars > MAX_CONVERSATION_CHARS) {
    onChunk({ type: 'error', error: 'Conversation is too long. Please start a new chat.' });
    return;
  }

  try {
    const authHeaders = await getEdgeAuthHeaders();
    const response = await fetch(ADVISOR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        messages,
        systemPrompt,
        stream: false,
        model: options.model ?? HAIKU,
        ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
        ...(options.enableWebSearch ? { enableWebSearch: true } : {}),
        ...(options.purpose ? { purpose: options.purpose } : {}),
        ...(options.ticket ? { ticket: options.ticket } : {}),
      }),
    });

    if (!response.ok) {
      // 403/402 carry a gate code the UI needs (paywall vs. depleted warning)
      if (response.status === 403 || response.status === 402) {
        let code: StreamChunk['code'];
        try {
          const errBody = await response.json();
          if (errBody.error === 'pro_required') code = 'pro_required';
          else if (errBody.error === 'messages_depleted') code = 'messages_depleted';
        } catch { /* fall through to generic error */ }
        if (code) {
          onChunk({ type: 'error', code, error: code === 'pro_required'
            ? 'Free message limit reached.'
            : 'Monthly message allotment depleted.' });
          return;
        }
      }
      onChunk({ type: 'error', error: 'Unable to reach the AI service. Please try again.' });
      return;
    }

    const data = await response.json();
    const text = extractTextFromContent(data.content ?? []);
    if (text) onChunk({ type: 'text', text });
    onChunk({ type: 'done', quota: data.quota });
  } catch {
    onChunk({ type: 'error', error: 'An unexpected error occurred. Please try again.' });
  }
}

/**
 * Non-streaming version for simple one-shot queries (interview questions, analysis, etc.)
 */
export async function askClaudeOnce(
  userMessage: string,
  systemPrompt: string,
  options: AskOptions = {}
): Promise<string> {
  try {
    const authHeaders = await getEdgeAuthHeaders();
    const response = await fetch(ADVISOR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: userMessage }],
        systemPrompt,
        stream: false,
        model: options.model ?? HAIKU,
        ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
        ...(options.enableWebSearch ? { enableWebSearch: true } : {}),
        ...(options.purpose ? { purpose: options.purpose } : {}),
        ...(options.ticket ? { ticket: options.ticket } : {}),
      }),
    });

    const data = await response.json();
    return extractTextFromContent(data.content ?? []) || 'No response.';
  } catch {
    return 'An error occurred. Please try again.';
  }
}
