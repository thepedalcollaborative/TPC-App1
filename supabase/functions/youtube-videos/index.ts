// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHANNEL_ID = 'UCatp9V-Jx2KayYer0y052kw';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY');
    if (!YOUTUBE_API_KEY) {
      return new Response(JSON.stringify({ error: 'YouTube API key not configured' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const query: string = body.query ?? '';
    const pageToken: string = body.pageToken ?? '';

    const params = new URLSearchParams({
      part: 'snippet',
      channelId: CHANNEL_ID,
      type: 'video',
      order: 'date',
      maxResults: '25',
      key: YOUTUBE_API_KEY,
    });

    if (query.trim()) params.set('q', query.trim());
    if (pageToken) params.set('pageToken', pageToken);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    let ytData: Record<string, unknown>;
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text();
        return new Response(JSON.stringify({ error: 'YouTube API error', detail: errText, status: res.status }), {
          status: 200, // always 200 so client sees the error body
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      ytData = await res.json();
    } catch (fetchErr) {
      clearTimeout(timer);
      const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return new Response(JSON.stringify({ error: message }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const items = (ytData.items as unknown[]) ?? [];
    const videos = items.map((item: unknown) => {
      const i = item as Record<string, unknown>;
      const snippet = i.snippet as Record<string, unknown>;
      const id = i.id as Record<string, unknown>;
      const thumbnails = snippet.thumbnails as Record<string, unknown>;
      const medium = thumbnails?.medium as Record<string, unknown> | undefined;
      const def = thumbnails?.default as Record<string, unknown> | undefined;
      return {
        id: id?.videoId as string,
        title: snippet.title as string,
        description: snippet.description as string,
        thumbnail: (medium?.url ?? def?.url ?? '') as string,
        publishedAt: snippet.publishedAt as string,
        channelTitle: snippet.channelTitle as string,
      };
    });

    const pageInfo = ytData.pageInfo as Record<string, unknown> | undefined;

    return new Response(JSON.stringify({
      videos,
      nextPageToken: (ytData.nextPageToken as string) ?? null,
      totalResults: (pageInfo?.totalResults as number) ?? 0,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
