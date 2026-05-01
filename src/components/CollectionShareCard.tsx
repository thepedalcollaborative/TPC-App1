/**
 * CollectionShareCard
 *
 * Off-screen branded card captured by react-native-view-shot.
 * Supports filtering by category + optional price badge overlay.
 * Keep it always mounted off-screen so remote images pre-load before capture.
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { typography, categoryColors } from '../theme';

const tpcLogo = require('../../assets/tpc-square.png');

const CARD_W  = 360;
const COLS    = 3;
const PADDING = 20;
const GAP     = 8;
const CELL_W  = Math.floor((CARD_W - PADDING * 2 - GAP * (COLS - 1)) / COLS); // ~101
const PHOTO_H = 80;
const MAX_PEDALS = 9;

// Dark teal palette
const C = {
  bg:          '#0C1E1E',
  headerStart: '#1B3D3D',
  headerEnd:   '#0C2020',
  cellBg:      '#142828',
  border:      'rgba(255,255,255,0.07)',
};

// Price badge colours per mode
const PRICE_COLORS: Record<string, string> = {
  asking: '#D97706', // amber
  market: '#2BB5A0', // teal
  paid:   '#6B7280', // gray
};

export type PriceMode = 'none' | 'asking' | 'market' | 'paid';

export type CollectionPedal = {
  id: string;
  brand: string;
  model: string;
  imageUrl: string | null;
  category: string;
  marketValue: number | null;
  purchasePrice: number | null;
  askingPrice: number | null;
  listingStatus: 'for_sale' | 'for_trade' | 'for_sale_or_trade' | null;
  acquiredDate: string | null;
};

interface Props {
  pedals: CollectionPedal[];
  username?: string;
  priceMode?: PriceMode;
  /** Header headline — defaults to "MY COLLECTION" */
  title?: string;
  /** Optional subtitle override (e.g. "Drives · FS/FT only") */
  subtitle?: string;
}

function getPriceLabel(p: CollectionPedal, mode: PriceMode): string | null {
  switch (mode) {
    case 'asking':
      if (!p.listingStatus) return null;
      return p.askingPrice != null ? `$${p.askingPrice}` : 'FS';
    case 'market':
      return p.marketValue != null ? `$${Math.round(p.marketValue)}` : null;
    case 'paid':
      return p.purchasePrice != null ? `$${p.purchasePrice}` : null;
    default:
      return null;
  }
}

export const CollectionShareCard = React.forwardRef<View, Props>(
  ({ pedals, username, priceMode = 'none', title, subtitle }, ref) => {
    const shown = pedals.slice(0, MAX_PEDALS);
    const extra = pedals.length > MAX_PEDALS ? pedals.length - MAX_PEDALS : 0;
    const count = pedals.length;
    const defaultSub = `${count} pedal${count !== 1 ? 's' : ''}`;
    const badgeColor = priceMode !== 'none' ? PRICE_COLORS[priceMode] : undefined;

    // Split into rows of COLS
    const rows: CollectionPedal[][] = [];
    for (let i = 0; i < shown.length; i += COLS) rows.push(shown.slice(i, i + COLS));

    return (
      <View ref={ref} style={styles.card}>

        {/* ── Header ── */}
        <LinearGradient
          colors={[C.headerStart, C.headerEnd]}
          style={styles.header}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.headerTop}>
            <View style={styles.headerIconWrap}>
              <Ionicons name="cube-outline" size={11} color="rgba(255,255,255,0.6)" />
              <Text style={styles.headerTag}>VAULT</Text>
            </View>
            {username ? <Text style={styles.headerUser}>@{username}</Text> : null}
          </View>
          <Text style={styles.headerHeadline}>{title ?? 'MY COLLECTION'}</Text>
          <Text style={styles.headerSub}>{subtitle ?? defaultSub}</Text>
        </LinearGradient>

        {/* ── Photo grid ── */}
        <View style={styles.grid}>
          {rows.map((row, ri) => (
            <View key={ri} style={[styles.gridRow, ri > 0 && styles.gridRowBorder]}>
              {row.map((p, ci) => {
                const catColor    = (categoryColors as Record<string, string>)[p.category] ?? '#2BB5A0';
                const initial     = (p.model?.trim()?.[0] ?? '?').toUpperCase();
                const isOverflow  = extra > 0 && ri === rows.length - 1 && ci === row.length - 1;
                const priceLabel  = priceMode !== 'none' ? getPriceLabel(p, priceMode) : null;

                return (
                  <View key={ci} style={[styles.cell, ci > 0 && styles.cellBorderLeft]}>
                    <View style={styles.photoWrap}>
                      {p.imageUrl ? (
                        <Image source={{ uri: p.imageUrl }} style={styles.photo} resizeMode="cover" />
                      ) : (
                        <View style={[styles.photoFallback, { backgroundColor: catColor + '22' }]}>
                          <Text style={[styles.photoInitial, { color: catColor }]}>{initial}</Text>
                        </View>
                      )}
                      {/* Price badge overlay */}
                      {priceLabel && badgeColor ? (
                        <View style={[styles.priceBadge, { backgroundColor: badgeColor }]}>
                          <Text style={styles.priceBadgeText}>{priceLabel}</Text>
                        </View>
                      ) : null}
                      {/* Overflow indicator */}
                      {isOverflow ? (
                        <View style={styles.overflowOverlay}>
                          <Text style={styles.overflowText}>+{extra}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.cellText}>
                      <Text style={styles.cellBrand} numberOfLines={1}>{p.brand}</Text>
                      <Text style={styles.cellModel} numberOfLines={1}>{p.model}</Text>
                    </View>
                  </View>
                );
              })}
              {/* Fill partial last row */}
              {Array.from({ length: COLS - row.length }).map((_, ei) => (
                <View key={`empty-${ei}`} style={[styles.cell, styles.cellBorderLeft]} />
              ))}
            </View>
          ))}
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <Image source={tpcLogo} style={styles.logo} resizeMode="contain" />
            <View>
              <Text style={styles.footerBrand}>The Pedal Collaborative</Text>
              <Text style={styles.footerUrl}>thepedalcollaborative.com</Text>
            </View>
          </View>
          <View style={styles.appStorePill}>
            <Ionicons name="logo-apple" size={10} color="rgba(255,255,255,0.8)" />
            <Text style={styles.appStoreText}>App Store</Text>
          </View>
        </View>

      </View>
    );
  },
);

CollectionShareCard.displayName = 'CollectionShareCard';

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    backgroundColor: C.bg,
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: PADDING,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 3,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerIconWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  headerTag: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  headerUser: {
    fontSize: 11,
    fontFamily: typography.bodyMedium,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.3,
  },
  headerHeadline: {
    fontSize: 26,
    fontFamily: typography.display,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },
  grid: {},
  gridRow: {
    flexDirection: 'row',
  },
  gridRowBorder: {
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  cell: {
    width: CELL_W,
    flex: 1,
    paddingBottom: 10,
    backgroundColor: C.bg,
  },
  cellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: C.border,
  },
  photoWrap: {
    width: '100%',
    height: PHOTO_H,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: PHOTO_H,
    backgroundColor: C.cellBg,
  },
  photoFallback: {
    width: '100%',
    height: PHOTO_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    fontSize: 28,
    fontFamily: typography.display,
    opacity: 0.7,
  },
  priceBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  priceBadgeText: {
    fontSize: 9,
    fontFamily: typography.bodySemiBold,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  overflowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    fontSize: 20,
    fontFamily: typography.display,
    color: '#FFFFFF',
  },
  cellText: {
    paddingHorizontal: 8,
    paddingTop: 7,
    gap: 1,
  },
  cellBrand: {
    fontSize: 9,
    fontFamily: typography.bodyMedium,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cellModel: {
    fontSize: 11,
    fontFamily: typography.bodySemiBold,
    color: '#FFFFFF',
    marginTop: 1,
  },
  footer: {
    backgroundColor: '#080F0F',
    paddingHorizontal: PADDING,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 32,
    height: 32,
  },
  footerBrand: {
    fontSize: 11,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.75)',
  },
  footerUrl: {
    fontSize: 9,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 1,
  },
  appStorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  appStoreText: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.3,
  },
});
