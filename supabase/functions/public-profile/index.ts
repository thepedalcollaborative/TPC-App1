// public-profile — serves a shareable HTML profile page.
//
// URL: /functions/v1/public-profile?u=username
//   or /functions/v1/public-profile/username  (path style)
//
// Non-authenticated — uses the anon key to call get_public_profile().
// Returns 404 HTML if user not found or profile is private.
// Returns rich OG meta tags so share previews look great on iMessage/Twitter/etc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APP_STORE_URL = 'https://apps.apple.com/app/id6760872172';
const TPC_TEAL      = '#2BB5A0';
const TPC_DARK      = '#0F1A19';

interface PublicProfile {
  display_name:  string | null;
  username:      string;
  member_since:  string;
  tone_identity: string | null;
  genres:        string[] | null;
  playing_style: string | null;
  owned_count:   number;
  board_count:   number;
  pedals: Array<{ brand: string; model: string; category: string; image_url: string | null }>;
}

const CATEGORY_COLORS: Record<string, string> = {
  drive: '#C45208', boost: '#F59E0B', compressor: '#22C55E', eq: '#0EA5E9',
  delay: '#2563EB', reverb: '#8B5CF6', modulation: '#EC4899', looper: '#14B8A6',
  pitch: '#A16207', utility: '#6B7280', ambient: '#C026D3', synth: '#4F46E5',
  other: '#94A3B8', multifx: '#F97316', modeler: '#38BDF8', fuzz: '#DC2626',
  distortion: '#9A3412', chorus: '#0D9488', phaser: '#65A30D', flanger: '#6366F1',
  tremolo: '#B45309', wah: '#D97706', octave: '#7C3AED', volume: '#78716C',
  noisegate: '#15803D', buffer: '#334155', preamp: '#92400E',
};

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? '#94A3B8';
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildHtml(profile: PublicProfile, username: string): string {
  const name        = profile.display_name ?? `@${username}`;
  const genreStr    = profile.genres?.join(', ') ?? '';
  const description = [
    profile.owned_count ? `${profile.owned_count} pedals in the vault` : null,
    genreStr             ? `Plays ${genreStr}`                           : null,
    profile.tone_identity ? profile.tone_identity                        : null,
  ].filter(Boolean).join(' · ');

  const pedalCards = (profile.pedals ?? []).map(p => `
    <div class="pedal-card">
      ${p.image_url
        ? `<img class="pedal-img" src="${p.image_url}" alt="${p.brand} ${p.model}" loading="lazy">`
        : `<div class="pedal-img pedal-img-placeholder" style="background:${categoryColor(p.category)}22">
             <span style="color:${categoryColor(p.category)};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">${cap(p.category)}</span>
           </div>`
      }
      <div class="pedal-info">
        <div class="pedal-brand">${p.brand}</div>
        <div class="pedal-model">${p.model}</div>
        <div class="pedal-cat" style="background:${categoryColor(p.category)}22;color:${categoryColor(p.category)}">${cap(p.category)}</div>
      </div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}'s Vault · The Pedal Collaborative</title>

  <!-- OG / social preview -->
  <meta property="og:title"       content="${name}'s Vault · TPC">
  <meta property="og:description" content="${description || 'Gear vault on The Pedal Collaborative'}">
  <meta property="og:type"        content="profile">
  <meta property="og:site_name"   content="The Pedal Collaborative">
  <meta name="twitter:card"       content="summary">
  <meta name="twitter:title"      content="${name}'s Vault · TPC">
  <meta name="twitter:description" content="${description || 'Gear vault on The Pedal Collaborative'}">

  <!-- Deep link: open in TPC app if installed -->
  <meta http-equiv="refresh" content="0.5;url=tpc://profile/${username}">

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${TPC_DARK};
      color: #F5F2EE;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #0F2521 0%, ${TPC_DARK} 100%);
      border-bottom: 1px solid rgba(43,181,160,0.2);
      padding: 24px 20px 20px;
    }
    .logo {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      color: ${TPC_TEAL};
      text-transform: uppercase;
      margin-bottom: 20px;
    }
    .profile-row {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, ${TPC_TEAL}, #0F2521);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
    }
    .profile-name  { font-size: 22px; font-weight: 700; color: #fff; }
    .profile-user  { font-size: 14px; color: ${TPC_TEAL}; margin-top: 2px; }
    .profile-since { font-size: 12px; color: rgba(245,242,238,0.45); margin-top: 4px; }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
    .chip {
      background: rgba(43,181,160,0.12);
      border: 1px solid rgba(43,181,160,0.3);
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 12px;
      color: ${TPC_TEAL};
    }
    .stats-row {
      display: flex;
      gap: 24px;
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .stat { text-align: center; }
    .stat-num  { font-size: 22px; font-weight: 700; color: #fff; }
    .stat-lbl  { font-size: 11px; color: rgba(245,242,238,0.45); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      color: rgba(245,242,238,0.45);
      text-transform: uppercase;
      padding: 20px 20px 12px;
    }
    .pedal-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px;
      padding: 0 16px 24px;
    }
    .pedal-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      overflow: hidden;
    }
    .pedal-img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      display: block;
    }
    .pedal-img-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .pedal-info   { padding: 8px 10px 10px; }
    .pedal-brand  { font-size: 10px; color: rgba(245,242,238,0.5); text-transform: uppercase; letter-spacing: 0.5px; }
    .pedal-model  { font-size: 13px; font-weight: 600; color: #fff; margin-top: 2px; line-height: 1.2; }
    .pedal-cat    { display: inline-block; margin-top: 5px; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 999px; text-transform: capitalize; }
    .cta-wrap {
      padding: 20px;
      text-align: center;
      border-top: 1px solid rgba(255,255,255,0.07);
    }
    .cta-text { font-size: 13px; color: rgba(245,242,238,0.55); margin-bottom: 14px; line-height: 1.5; }
    .cta-btn {
      display: inline-block;
      background: ${TPC_TEAL};
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      padding: 14px 32px;
      border-radius: 999px;
      text-decoration: none;
    }
    .open-app-btn {
      display: inline-block;
      margin-top: 10px;
      background: transparent;
      border: 1px solid rgba(43,181,160,0.4);
      color: ${TPC_TEAL};
      font-size: 14px;
      font-weight: 600;
      padding: 12px 28px;
      border-radius: 999px;
      text-decoration: none;
      cursor: pointer;
    }
    @media (max-width: 400px) {
      .pedal-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">✦ The Pedal Collaborative</div>
    <div class="profile-row">
      <div class="avatar">${name.charAt(0).toUpperCase()}</div>
      <div>
        <div class="profile-name">${name}</div>
        <div class="profile-user">@${username}</div>
        <div class="profile-since">Member since ${profile.member_since}</div>
      </div>
    </div>
    ${genreStr || profile.tone_identity || profile.playing_style ? `
    <div class="chips">
      ${genreStr        ? `<span class="chip">${genreStr}</span>`               : ''}
      ${profile.tone_identity  ? `<span class="chip">${profile.tone_identity}</span>`  : ''}
      ${profile.playing_style  ? `<span class="chip">${profile.playing_style}</span>`  : ''}
    </div>` : ''}
  </div>

  <div class="stats-row">
    <div class="stat">
      <div class="stat-num">${profile.owned_count}</div>
      <div class="stat-lbl">In the Vault</div>
    </div>
    <div class="stat">
      <div class="stat-num">${profile.board_count}</div>
      <div class="stat-lbl">Boards</div>
    </div>
  </div>

  ${pedalCards ? `
  <div class="section-title">The Vault</div>
  <div class="pedal-grid">${pedalCards}</div>
  ` : ''}

  <div class="cta-wrap">
    <div class="cta-text">
      Catalog your gear, get AI-powered tone advice,<br>and connect with other collectors.
    </div>
    <a class="cta-btn" href="${APP_STORE_URL}">Download TPC — Free</a>
    <br>
    <a class="open-app-btn" href="tpc://profile/${username}">Open in TPC App</a>
  </div>
</body>
</html>`;
}

function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Profile not found · TPC</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, sans-serif; background: #0F1A19; color: #F5F2EE;
           display: flex; flex-direction: column; align-items: center; justify-content: center;
           min-height: 100vh; text-align: center; padding: 24px; }
    h1 { font-size: 22px; margin-bottom: 10px; }
    p  { color: rgba(245,242,238,0.5); font-size: 15px; margin-bottom: 28px; }
    a  { background: #2BB5A0; color: #fff; padding: 14px 32px; border-radius: 999px;
         text-decoration: none; font-weight: 700; font-size: 15px; }
  </style>
</head>
<body>
  <h1>Profile not found</h1>
  <p>This profile is private or doesn't exist.</p>
  <a href="https://apps.apple.com/app/id6760872172">Download TPC</a>
</body>
</html>`;
}

const SECURITY_HEADERS = {
  'X-Frame-Options':           'SAMEORIGIN',
  'X-Content-Type-Options':    'nosniff',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  // No inline scripts — all style is inline CSS, so unsafe-inline is needed there only.
  'Content-Security-Policy':   "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'",
};

Deno.serve(async (req) => {
  // Extract username from ?u=foo or /public-profile/foo path style
  const url      = new URL(req.url);
  const pathSeg  = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const username = (url.searchParams.get('u') ?? (pathSeg !== 'public-profile' ? pathSeg : '')).toLowerCase().trim();

  if (!username) {
    return new Response(notFoundHtml(), { status: 404, headers: { 'Content-Type': 'text/html', ...SECURITY_HEADERS } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  );

  const { data, error } = await supabase.rpc('get_public_profile', { p_username: username });

  if (error || !data) {
    return new Response(notFoundHtml(), { status: 404, headers: { 'Content-Type': 'text/html', ...SECURITY_HEADERS } });
  }

  const html = buildHtml(data as PublicProfile, username);
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60', ...SECURITY_HEADERS },
  });
});
