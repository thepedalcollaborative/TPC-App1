// Advisor memory — persists a rolling plain-text summary of what the AI has
// learned about a player across sessions. Stored in advisor_memory (one row per
// user, upserted after each Advisor session or Expert pick).
//
// refreshMemory() fires a background Haiku call to summarise the latest exchange,
// then saves it. It's non-blocking and silent on failure — memory is a best-effort
// enhancement, never a hard dependency.

import Constants from 'expo-constants';
import { supabase, EDGE_AUTH_HEADER } from './supabase';

const extra: Record<string, unknown> =
  (Constants.expoConfig?.extra as Record<string, unknown>) ??
  ((Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra) ??
  {};

const ADVISOR_URL = `${(extra.supabaseUrl as string) ?? ''}/functions/v1/tpc-advisor`;

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadMemory(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('advisor_memory')
      .select('summary')
      .eq('user_id', userId)
      .maybeSingle();
    return data?.summary ?? '';
  } catch {
    return '';
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

export async function saveMemory(userId: string, summary: string): Promise<void> {
  await supabase
    .from('advisor_memory')
    .upsert(
      { user_id: userId, summary, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}

// ── Refresh (background) ──────────────────────────────────────────────────────
// Call after each completed Advisor or Expert pick exchange.
// Uses Haiku (cheapest) — just a small summarisation task.

export async function refreshMemory(
  userId: string,
  existingMemory: string,
  exchange: { userMessage: string; assistantMessage: string }
): Promise<void> {
  try {
    const prompt = `You are a memory system for a guitar pedal advisor AI. Update the player memory below with any important new information from the latest exchange.

Keep the memory under 300 words. Focus on:
- Playing style, genres, guitar and amp rig
- Tone goals and what they're chasing
- Budget hints or constraints
- Specific pedals discussed, recommended, rejected, or retired
- Preferences about brand, complexity, boutique vs mass-market
- Anything that helps give better recommendations next session

Remove or replace outdated info if something new contradicts it. If the exchange contains nothing worth remembering, return the existing memory unchanged.

EXISTING MEMORY:
${existingMemory || '(none yet)'}

LATEST EXCHANGE:
Player: ${exchange.userMessage.slice(0, 800)}
Advisor: ${exchange.assistantMessage.slice(0, 800)}

Return ONLY the updated memory text. No preamble, no explanation.`;

    const response = await fetch(ADVISOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...EDGE_AUTH_HEADER },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: 'You are a concise memory summariser. Return only the updated memory text.',
        stream: false,
        // Default Haiku model — cheapest, plenty fast enough for summarisation
      }),
    });

    if (!response.ok) return;

    const data = await response.json();
    const updated = data.content?.find((c: { type: string; text?: string }) => c.type === 'text')?.text ?? '';
    if (updated.trim()) await saveMemory(userId, updated.trim());
  } catch {
    // Memory update failures are silent — the app works fine without it
  }
}
