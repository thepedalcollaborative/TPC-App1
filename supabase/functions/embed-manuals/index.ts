// embed-manuals — chunks pedals.manual_text and embeds each chunk with the
// Supabase edge runtime's built-in gte-small model (384 dims, free) into
// manual_chunks for semantic retrieval by tpc-advisor.
//
// Idempotent: hashes each pedal's manual_text; pedals whose hash matches the
// stored chunks are skipped, changed manuals get their chunks replaced.
//
// Invoke manually or from cron with the x-cron-secret header. Pass
// {"test_query": "..."} to instead run a retrieval check and return the top
// matching chunks — used to verify quality end-to-end.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET          = Deno.env.get('CRON_SECRET') ?? '';

const CHUNK_SIZE    = 1400;
const CHUNK_OVERLAP = 150;

// deno-lint-ignore no-explicit-any
declare const Supabase: any;
const embedder = new Supabase.ai.Session('gte-small');

async function embed(text: string): Promise<number[]> {
  const out = await embedder.run(text, { mean_pool: true, normalize: true });
  return Array.from(out as Iterable<number>);
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Split on paragraph boundaries, packing paragraphs into ~CHUNK_SIZE chunks
// with a little overlap so section headers stay attached to their content.
function chunkText(text: string): string[] {
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const para of paras) {
    if (current && current.length + para.length + 2 > CHUNK_SIZE) {
      chunks.push(current);
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
    // Hard-split any monster paragraph
    while (current.length > CHUNK_SIZE * 1.5) {
      chunks.push(current.slice(0, CHUNK_SIZE));
      current = current.slice(CHUNK_SIZE - CHUNK_OVERLAP);
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const body = await req.json().catch(() => ({}));

  // ── Retrieval test mode ────────────────────────────────────────────────────
  if (body.test_query) {
    const qEmbedding = await embed(body.test_query);
    const { data, error } = await supabase.rpc('match_manual_chunks', {
      query_embedding: qEmbedding,
      match_count: body.match_count ?? 5,
      filter_pedal_ids: body.pedal_ids ?? null,
    });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    // Attach pedal names for readability
    const ids = [...new Set((data ?? []).map((r: { pedal_id: string }) => r.pedal_id))];
    const { data: pedals } = await supabase.from('pedals').select('id, brand, model').in('id', ids);
    const nameMap = new Map((pedals ?? []).map((p: { id: string; brand: string; model: string }) => [p.id, `${p.brand} ${p.model}`]));
    return new Response(JSON.stringify(
      (data ?? []).map((r: { pedal_id: string; content: string; similarity: number }) => ({
        pedal: nameMap.get(r.pedal_id),
        similarity: Math.round(r.similarity * 1000) / 1000,
        preview: r.content.slice(0, 200),
      })), null, 2), { headers: { 'Content-Type': 'application/json' } });
  }

  // ── Ingestion ──────────────────────────────────────────────────────────────
  const { data: pedals, error } = await supabase
    .from('pedals')
    .select('id, brand, model, manual_text')
    .not('manual_text', 'is', null)
    .neq('manual_text', '');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  // Edge workers have a tiny compute budget for the embedder — even one
  // manual's ~25 chunks trips WORKER_RESOURCE_LIMIT. So each invocation embeds
  // at most chunk_batch chunks and inserts them immediately; progress is
  // resumable because chunks carry (pedal_id, chunk_index, source_hash).
  // The caller loops until done: true.
  const chunkBatch = Number(body.chunk_batch ?? 8);
  let embeddedChunks = 0, pedalsDone = 0, pedalsPending = 0;

  for (const p of (pedals ?? []) as Array<{ id: string; brand: string; model: string; manual_text: string }>) {
    if (p.manual_text.length < 500) { pedalsDone++; continue; }
    const hash = await sha256(p.manual_text);
    const chunks = chunkText(p.manual_text).map(c => `[${p.brand} ${p.model} manual] ${c}`);

    const { data: existingRows } = await supabase
      .from('manual_chunks')
      .select('chunk_index, source_hash')
      .eq('pedal_id', p.id);
    const sameHash = (existingRows ?? []).filter((r: { source_hash: string }) => r.source_hash === hash);

    if (sameHash.length >= chunks.length) { pedalsDone++; continue; }

    // Stale chunks from an older manual version — clear and restart this pedal
    if ((existingRows ?? []).length > sameHash.length) {
      await supabase.from('manual_chunks').delete().eq('pedal_id', p.id).neq('source_hash', hash);
    }

    if (embeddedChunks >= chunkBatch) { pedalsPending++; continue; }

    const doneIndexes = new Set(sameHash.map((r: { chunk_index: number }) => r.chunk_index));
    try {
      for (let i = 0; i < chunks.length && embeddedChunks < chunkBatch; i++) {
        if (doneIndexes.has(i)) continue;
        const embedding = await embed(chunks[i]);
        const { error: insErr } = await supabase.from('manual_chunks').insert({
          pedal_id: p.id, chunk_index: i, content: chunks[i], source_hash: hash, embedding,
        });
        if (insErr) throw insErr;
        embeddedChunks++;
      }
      const finished = doneIndexes.size + embeddedChunks >= chunks.length;
      if (finished) pedalsDone++; else pedalsPending++;
    } catch (e) {
      console.error(`[embed-manuals] ${p.brand} ${p.model}:`, (e as Error).message);
      pedalsPending++;
    }
  }

  return new Response(
    JSON.stringify({
      embedded_chunks: embeddedChunks,
      pedals_done: pedalsDone,
      pedals_pending: pedalsPending,
      done: pedalsPending === 0,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
