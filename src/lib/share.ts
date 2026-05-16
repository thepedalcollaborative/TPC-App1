// ─── TPC Share Utilities ──────────────────────────────────────────────────────
// Text sharing: native iOS/Android Share API — opens share sheet with every
// installed app (Instagram, TikTok, Facebook, X, Messages, etc.)
//
// Image sharing: react-native-view-shot captures a branded ShareCard component
// as a 1080×1080 PNG, then expo-sharing shares the file. The native share sheet
// surfaces the image to Instagram Stories, TikTok, etc.

import { Share } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import type React from 'react';

/**
 * Capture a React Native view ref as a PNG and share it as an image.
 * Pass the ref returned by useRef<View>() attached to a <ShareCard>.
 *
 * Instagram and TikTok both appear in the native share sheet when an image
 * file is shared — no deep-linking tricks needed.
 */
export async function shareAsImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: React.RefObject<any>,
): Promise<void> {
  if (!ref.current) return;
  const uri = await captureRef(ref, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
  });
  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
    } else {
      // Fallback: native Share (shows the file path — rare edge case)
      await Share.share({ url: uri });
    }
  } finally {
    // Clean up temp file so it doesn't accumulate in the app cache
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

const APP_URL = 'https://thepedalcollaborative.com';
const TAGS = '#guitarpedals #pedalboard #tonehunter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Trim a string to its first complete sentence, or to `max` chars. */
function firstSentence(text: string, max = 120): string {
  const m = text.match(/^[^.!?]+[.!?]/);
  if (m && m[0].length <= max) return m[0].trim();
  return text.length <= max ? text.trim() : text.slice(0, max).trimEnd() + '…';
}

/** Unicode block bar: 5 filled/empty segments. */
function bar(v: number, total = 5): string {
  const n = Math.min(Math.max(Math.round(v), 0), total);
  return '█'.repeat(n) + '░'.repeat(total - n);
}

// ─── Share functions ──────────────────────────────────────────────────────────

/**
 * Share a Custom Shop recommendation.
 * Moment: after the AI delivers its pick.
 */
export async function shareRecommendation(
  brand: string,
  model: string,
  why: string,
): Promise<void> {
  const msg = [
    `TPC Custom Shop picked the ${brand} ${model} for my sound 🎸`,
    '',
    `"${firstSentence(why)}"`,
    '',
    `Find yours → ${APP_URL}`,
    '',
    TAGS,
  ].join('\n');
  await Share.share({ message: msg });
}

export type ShareSpiderValues = {
  drive: number;
  modulation: number;
  timeSpace: number;
  dynamics: number;
  loopersMulti: number;
  experimental: number;
  utility: number;
};

/**
 * Share the Sound DNA spider-chart as a text visualization.
 * Moment: after the spider chart animates in.
 */
export async function shareSoundDNA(v: ShareSpiderValues): Promise<void> {
  const msg = [
    'My guitar tone DNA 🕷️',
    '',
    `🔥 Drive/Dirt    ${bar(v.drive)} ${v.drive.toFixed(1)}/5`,
    `🌊 Modulation    ${bar(v.modulation)} ${v.modulation.toFixed(1)}/5`,
    `⏱ Time/Space    ${bar(v.timeSpace)} ${v.timeSpace.toFixed(1)}/5`,
    `💎 Dynamics      ${bar(v.dynamics)} ${v.dynamics.toFixed(1)}/5`,
    `🔄 Looper/Multi  ${bar(v.loopersMulti)} ${v.loopersMulti.toFixed(1)}/5`,
    `🌀 Experimental  ${bar(v.experimental)} ${v.experimental.toFixed(1)}/5`,
    `🎛 Utility       ${bar(v.utility)} ${v.utility.toFixed(1)}/5`,
    '',
    `Analyzed by TPC — ${APP_URL}`,
    '',
    '#guitarpedals #tonehunter #pedalboard',
  ].join('\n');
  await Share.share({ message: msg });
}

/**
 * Share the moment a new pedal lands in the collection.
 * Moment: right after a pedal is added as "owned".
 */
export async function shareNewPedal(brand: string, model: string): Promise<void> {
  const msg = [
    `Just added the ${brand} ${model} to my rig 🎸`,
    '',
    `Tracking my gear with TPC — ${APP_URL}`,
    '',
    '#pedalboard #guitarpedals #newgear',
  ].join('\n');
  await Share.share({ message: msg });
}

/**
 * Share a collection milestone (5, 10, 25, 50 pedals).
 * Moment: milestone modal celebration.
 */
export async function shareVaultMilestone(
  pedalCount: number,
  marketValue?: number,
): Promise<void> {
  const label =
    pedalCount >= 50 ? `I'm a serious collector now 🏆` :
    pedalCount >= 25 ? `That's a real collection 🎸` :
    pedalCount >= 10 ? `My vault is filling up 🎛` :
    `Officially a collector 🎉`;

  const valueLine = marketValue && marketValue > 0
    ? `Est. value: $${Math.round(marketValue).toLocaleString()}`
    : null;

  const lines: (string | null)[] = [
    label,
    '',
    `${pedalCount} pedals in my TPC vault.`,
    valueLine,
    '',
    `Track yours → ${APP_URL}`,
    '',
    TAGS,
  ];
  const msg = lines.filter(Boolean).join('\n');
  await Share.share({ message: msg });
}

/**
 * Share a profile / rig summary.
 * Moment: Profile screen "Share My Rig" button.
 */
export async function shareProfile(
  displayName: string,
  ownedCount: number,
  genres?: string[],
  toneIdentity?: string,
): Promise<void> {
  const genreLine = genres?.length ? `Genres: ${genres.slice(0, 3).join(', ')}` : null;
  const toneLine  = toneIdentity
    ? `Tone: "${toneIdentity.slice(0, 80)}${toneIdentity.length > 80 ? '…' : ''}"`
    : null;

  const lines: (string | null)[] = [
    `🎛 ${displayName}'s Pedal Vault`,
    '',
    `${ownedCount} pedal${ownedCount !== 1 ? 's' : ''} and counting.`,
    genreLine,
    toneLine,
    '',
    `Build yours → ${APP_URL}`,
    '',
    TAGS,
  ];
  const msg = lines.filter(Boolean).join('\n');
  await Share.share({ message: msg });
}

/**
 * Share a TPC Advisor response.
 * Moment: small share button below the last completed assistant message.
 */
export async function shareAdvisorResponse(text: string): Promise<void> {
  // Trim to first ~280 chars for a clean snippet
  const snippet = text.length > 280 ? text.slice(0, 280).trimEnd() + '…' : text;
  const msg = [
    `TPC Advisor just told me: 🎛`,
    '',
    `"${snippet}"`,
    '',
    `Ask yours → ${APP_URL}`,
    '',
    '#guitarpedals #pedalboard #tonehunter',
  ].join('\n');
  await Share.share({ message: msg });
}

/**
 * Share a single GAS or Pass find.
 * Moment: immediately after swiping GAS on a pedal.
 */
export async function shareGasFind(brand: string, model: string): Promise<void> {
  const msg = [
    `GASing hard for the ${brand} ${model} 🔥`,
    '',
    `Found it on TPC — ${APP_URL}`,
    '',
    '#guitarpedals #GAS #pedalboard #tonehunter',
  ].join('\n');
  await Share.share({ message: msg });
}

/**
 * Share the user's full GAS List (wishlist).
 * Moment: "Share GAS List" button in the wishlist tab.
 */
export async function shareGasList(
  pedals: Array<{ brand: string; model: string }>,
): Promise<void> {
  const shown = pedals.slice(0, 8).map(p => `• ${p.brand} ${p.model}`);
  if (pedals.length > 8) shown.push(`+${pedals.length - 8} more`);
  const msg = [
    `My GAS List 🔥`,
    '',
    ...shown,
    '',
    `${pedals.length} pedal${pedals.length !== 1 ? 's' : ''} on my radar. Track yours on TPC — ${APP_URL}`,
    '',
    '#guitarpedals #GAS #pedalNGD #tonehunter',
  ].join('\n');
  await Share.share({ message: msg });
}

/**
 * Share a GAS or Pass session summary.
 * Moment: from the session summary screen.
 */
export async function shareGasSession(
  gasCount: number,
  pedals: Array<{ brand: string; model: string }>,
): Promise<void> {
  const topPedal = pedals[0];
  const headline = topPedal
    ? `Just GAS'd ${gasCount} pedal${gasCount !== 1 ? 's' : ''} on TPC — starting with the ${topPedal.brand} ${topPedal.model} 🔥`
    : `Swiped through pedals on TPC and GAS'd ${gasCount} of them 🔥`;
  const msg = [
    headline,
    '',
    `Find yours → ${APP_URL}`,
    '',
    '#guitarpedals #GAS #pedalboard #tonehunter',
  ].join('\n');
  await Share.share({ message: msg });
}

/**
 * Share the user's FS/FT list.
 * Moment: "Share My FS/FT List" strip in the For Sale/Trade tab.
 */
export type FsftPedal = {
  brand: string;
  model: string;
  listing_status: 'for_sale' | 'for_trade' | 'for_sale_or_trade';
  asking_price: number | null;
};

export async function shareFsftList(pedals: FsftPedal[]): Promise<void> {
  const lines: string[] = [];
  for (const p of pedals.slice(0, 10)) {
    let line = `• ${p.brand} ${p.model}`;
    if (p.listing_status === 'for_sale' || p.listing_status === 'for_sale_or_trade') {
      line += p.asking_price != null ? ` — $${p.asking_price}` : ' — FS';
    }
    if (p.listing_status === 'for_trade' || p.listing_status === 'for_sale_or_trade') {
      line += ' — FT';
    }
    lines.push(line);
  }
  if (pedals.length > 10) lines.push(`+${pedals.length - 10} more`);

  const hasFS = pedals.some(p => p.listing_status !== 'for_trade');
  const hasFT = pedals.some(p => p.listing_status !== 'for_sale');
  const headline =
    hasFS && hasFT ? 'Pedals For Sale & Trade 🎸' :
    hasFS           ? 'Pedals For Sale 💰' :
                      'Pedals For Trade 🔄';

  const msg = [
    headline,
    '',
    ...lines,
    '',
    `${pedals.length} pedal${pedals.length !== 1 ? 's' : ''} available. DMs open — tracked on TPC — ${APP_URL}`,
    '',
    '#guitarpedals #pedalboard #FS #FT #geartrade',
  ].join('\n');
  await Share.share({ message: msg });
}

const APP_STORE_URL = 'https://apps.apple.com/app/the-pedal-collaborative/id6741411198';

/**
 * Share the user's full collection (text fallback when image card fails).
 * Moment: "Share My Collection" strip in the Owned tab.
 */
export async function shareCollectionList(
  pedals: Array<{ brand: string; model: string }>,
  username?: string,
): Promise<void> {
  const shown = pedals.slice(0, 8).map(p => `• ${p.brand} ${p.model}`);
  if (pedals.length > 8) shown.push(`+${pedals.length - 8} more`);
  const header = username ? `${username}'s Pedal Vault 🎛` : 'My Pedal Vault 🎛';
  const msg = [
    header,
    '',
    ...shown,
    '',
    `${pedals.length} pedal${pedals.length !== 1 ? 's' : ''} and counting. Track yours on TPC — ${APP_STORE_URL}`,
    '',
    '#guitarpedals #pedalboard #tonehunter',
  ].join('\n');
  await Share.share({ message: msg });
}

/**
 * Share a full pedalboard.
 * Moment: from the board detail header.
 */
export async function shareBoard(
  boardName: string,
  pedals: Array<{ brand: string; model: string }>,
): Promise<void> {
  const list = pedals.slice(0, 8).map(p => `• ${p.brand} ${p.model}`);
  if (pedals.length > 8) list.push(`+${pedals.length - 8} more`);
  const msg = [
    `${boardName} 🎸`,
    '',
    ...list,
    '',
    `${pedals.length} pedal${pedals.length !== 1 ? 's' : ''}. Built on TPC — ${APP_URL}`,
    '',
    '#pedalboard #boardday #guitarpedals',
  ].join('\n');
  await Share.share({ message: msg });
}
