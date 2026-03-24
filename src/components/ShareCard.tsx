/**
 * ShareCard — off-screen branded image card captured by react-native-view-shot.
 *
 * Renders a 1080×1080 square card (scaled to fit on-screen) with TPC branding.
 * The parent renders it with pointerEvents="none" behind the main UI, calls
 * captureRef(), and shares the resulting file URI.
 *
 * Card types:
 *   pick      — Custom Shop recommendation (teal gradient)
 *   board     — Pedalboard share (rose gradient)
 *   milestone — Vault milestone celebration (gold gradient)
 *   rig       — Profile / rig summary (slate gradient)
 */

import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, typography, spacing } from '../theme';

// ─── Card size ────────────────────────────────────────────────────────────────
// 1080×1080 logical points — view-shot captures at this density.
// We scale it down visually so it fits on screen while hidden (via transform).
const CARD_SIZE = 1080;

const tpcLogo = require('../../assets/tpc-square.png');

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShareCardType = 'pick' | 'board' | 'milestone' | 'rig' | 'weekly';

export type ShareCardData =
  | { type: 'pick';      brand: string; model: string; why: string }
  | { type: 'weekly';    brand: string; model: string; why: string }
  | { type: 'board';     name: string; pedals: Array<{ brand: string; model: string }> }
  | { type: 'milestone'; count: number; marketValue?: number }
  | { type: 'rig';       displayName: string; ownedCount: number; genre?: string; tone?: string };

// ─── Gradient map ─────────────────────────────────────────────────────────────
const GRADIENTS: Record<ShareCardType, [string, string]> = {
  pick:      [colors.teal,    colors.tealDark],
  weekly:    [colors.gold,    colors.goldDark],
  board:     [colors.rose,    colors.roseDark],
  milestone: ['#B45309',      '#92400E'],  // amber-brown — distinct from weekly gold
  rig:       ['#1E293B',      '#0F172A'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function firstSentence(text: string, max = 160): string {
  const m = text.match(/^[^.!?]+[.!?]/);
  if (m && m[0].length <= max) return m[0].trim();
  return text.length <= max ? text.trim() : text.slice(0, max).trimEnd() + '…';
}

// ─── Content renderers ────────────────────────────────────────────────────────

function PickContent({ data }: { data: Extract<ShareCardData, { type: 'pick' }> }) {
  return (
    <>
      <View style={s.badgeRow}>
        <View style={s.badge}><Text style={s.badgeText}>✦ CUSTOM SHOP PICK</Text></View>
      </View>
      <Text style={s.headline}>{data.brand}</Text>
      <Text style={[s.headline, s.headlineAccent]}>{data.model}</Text>
      <View style={s.divider} />
      <Text style={s.body}>{firstSentence(data.why)}</Text>
    </>
  );
}

function WeeklyContent({ data }: { data: Extract<ShareCardData, { type: 'weekly' }> }) {
  return (
    <>
      <View style={s.badgeRow}>
        <View style={s.badge}><Text style={s.badgeText}>✦ WEEKLY PICK</Text></View>
      </View>
      <Text style={s.headline}>{data.brand}</Text>
      <Text style={[s.headline, s.headlineAccent]}>{data.model}</Text>
      <View style={s.divider} />
      <Text style={s.body}>{firstSentence(data.why)}</Text>
    </>
  );
}

function BoardContent({ data }: { data: Extract<ShareCardData, { type: 'board' }> }) {
  const shown = data.pedals.slice(0, 6);
  const overflow = data.pedals.length - shown.length;
  return (
    <>
      <View style={s.badgeRow}>
        <View style={s.badge}><Text style={s.badgeText}>✦ MY BOARD</Text></View>
      </View>
      <Text style={s.headline}>{data.name}</Text>
      <View style={s.divider} />
      {shown.map((p, i) => (
        <Text key={i} style={s.listItem}>• {p.brand} {p.model}</Text>
      ))}
      {overflow > 0 && <Text style={s.listItem}>+{overflow} more</Text>}
    </>
  );
}

function MilestoneContent({ data }: { data: Extract<ShareCardData, { type: 'milestone' }> }) {
  const label =
    data.count >= 100 ? 'LEGENDARY COLLECTOR' :
    data.count >= 50  ? 'SERIOUS COLLECTOR'   :
    data.count >= 25  ? 'REAL COLLECTION'      :
    data.count >= 10  ? 'VAULT FILLING UP'     :
                        'OFFICIALLY A COLLECTOR';
  return (
    <>
      <View style={s.badgeRow}>
        <View style={s.badge}><Text style={s.badgeText}>✦ MILESTONE</Text></View>
      </View>
      <Text style={[s.headline, { fontSize: 96 }]}>{data.count}</Text>
      <Text style={s.headlineSub}>PEDALS IN THE VAULT</Text>
      <View style={s.divider} />
      <Text style={s.subLabel}>{label}</Text>
      {data.marketValue && data.marketValue > 0 && (
        <Text style={s.body}>
          Est. collection value: ${Math.round(data.marketValue).toLocaleString()}
        </Text>
      )}
    </>
  );
}

function RigContent({ data }: { data: Extract<ShareCardData, { type: 'rig' }> }) {
  return (
    <>
      <View style={s.badgeRow}>
        <View style={s.badge}><Text style={s.badgeText}>✦ MY RIG</Text></View>
      </View>
      <Text style={s.headline}>{data.displayName}</Text>
      <View style={s.divider} />
      <Text style={s.body}>{data.ownedCount} pedal{data.ownedCount !== 1 ? 's' : ''} and counting</Text>
      {data.genre ? <Text style={s.body}>{data.genre}</Text> : null}
      {data.tone  ? <Text style={[s.body, s.toneText]}>"{firstSentence(data.tone, 100)}"</Text> : null}
    </>
  );
}

// ─── HiddenShareCard ─────────────────────────────────────────────────────────
// Renders the card off-screen for react-native-view-shot capture.
// Place this at the root of any screen that uses useShareCard().

import { useRef as _useRef } from 'react';

type HiddenProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cardRef: React.RefObject<any>;
  cardData: ShareCardData | null;
};

export function HiddenShareCard({ cardRef, cardData }: HiddenProps) {
  if (!cardData) return null;
  return (
    <View
      ref={cardRef}
      collapsable={false}
      style={{
        position: 'absolute',
        left: -CARD_SIZE - 100,
        top: 0,
        width: CARD_SIZE,
        height: CARD_SIZE,
      }}
    >
      <ShareCard data={cardData} scale={1} />
    </View>
  );
}

// ─── ShareCard ────────────────────────────────────────────────────────────────

type Props = {
  data: ShareCardData;
  /** Scale factor so the card fits on-screen while hidden (default 0.25) */
  scale?: number;
};

export default function ShareCard({ data, scale = 0.25 }: Props) {
  const [g1, g2] = GRADIENTS[data.type];

  return (
    // Outer wrapper scaled down so it's invisible / off-screen visually
    <View style={[s.scaleWrapper, { transform: [{ scale }] }]} pointerEvents="none">
      <LinearGradient
        colors={[g1, g2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.card}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <View style={s.header}>
          <Image source={tpcLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.brandName}>THE PEDAL COLLABORATIVE</Text>
        </View>

        {/* ── Content ────────────────────────────────────────── */}
        <View style={s.content}>
          {data.type === 'pick'      && <PickContent      data={data} />}
          {data.type === 'weekly'    && <WeeklyContent    data={data} />}
          {data.type === 'board'     && <BoardContent     data={data} />}
          {data.type === 'milestone' && <MilestoneContent data={data} />}
          {data.type === 'rig'       && <RigContent       data={data} />}
        </View>

        {/* ── Footer ─────────────────────────────────────────── */}
        <View style={s.footer}>
          <Text style={s.footerText}>thepedalcollaborative.com</Text>
          <Text style={s.footerTags}>#guitarpedals #pedalboard #tonehunter</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  scaleWrapper: {
    // Origin top-left so it stays tucked away
    transformOrigin: 'top left',
  } as object,
  card: {
    width:  CARD_SIZE,
    height: CARD_SIZE,
    padding: 80,
    justifyContent: 'space-between',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  logo: {
    width: 72,
    height: 72,
  },
  brandName: {
    fontFamily: typography.display,
    fontSize: 28,
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 3,
  },

  // Content
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 40,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 28,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 40,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  badgeText: {
    fontFamily: typography.bodyMedium,
    fontSize: 22,
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 2,
  },
  headline: {
    fontFamily: typography.display,
    fontSize: 80,
    color: '#FFFFFF',
    lineHeight: 92,
  },
  headlineAccent: {
    color: 'rgba(255,255,255,0.85)',
  },
  headlineSub: {
    fontFamily: typography.display,
    fontSize: 44,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 4,
    marginTop: 8,
  },
  subLabel: {
    fontFamily: typography.bodyMedium,
    fontSize: 30,
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 2,
    marginBottom: 20,
  },
  divider: {
    width: 80,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 2,
    marginVertical: 32,
  },
  body: {
    fontFamily: typography.body,
    fontSize: 30,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 42,
    marginBottom: 16,
  },
  toneText: {
    fontStyle: 'italic',
  },
  listItem: {
    fontFamily: typography.body,
    fontSize: 28,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 44,
  },

  // Footer
  footer: {
    gap: 8,
  },
  footerText: {
    fontFamily: typography.bodyMedium,
    fontSize: 24,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1,
  },
  footerTags: {
    fontFamily: typography.body,
    fontSize: 22,
    color: 'rgba(255,255,255,0.5)',
  },
});
