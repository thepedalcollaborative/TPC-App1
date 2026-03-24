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
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
  } else {
    // Fallback: native Share (shows the file path — rare edge case)
    await Share.share({ url: uri });
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
