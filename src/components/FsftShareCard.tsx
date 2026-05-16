/**
 * FsftShareCard
 *
 * Off-screen branded card rendered by CollectionScreen and captured with
 * react-native-view-shot as a 1080-wide PNG, then shared via expo-sharing.
 *
 * Design: dark warm-background card with amber gradient header, per-pedal
 * FS/FT badges + asking prices, TPC branding in footer.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { typography } from '../theme';
import type { FsftPedal } from '../lib/share';

const CARD_W = 360;
const MAX_ROWS = 8;

// Amber palette — lives entirely inside this file
const AMBER = {
  bright: '#F59E0B',
  mid: '#D97706',
  deep: '#92400E',
  darkest: '#78350F',
};
const TEAL_BRIGHT = '#2BB5A0';

interface Props {
  pedals: FsftPedal[];
  username?: string;
}

export const FsftShareCard = React.forwardRef<View, Props>(
  ({ pedals, username }, ref) => {
    const shown = pedals.slice(0, MAX_ROWS);
    const extra = pedals.length > MAX_ROWS ? pedals.length - MAX_ROWS : 0;

    const hasFS = pedals.some(
      p => p.listing_status === 'for_sale' || p.listing_status === 'for_sale_or_trade',
    );
    const hasFT = pedals.some(
      p => p.listing_status === 'for_trade' || p.listing_status === 'for_sale_or_trade',
    );

    const headline =
      hasFS && hasFT ? 'For Sale & Trade' : hasFS ? 'For Sale' : 'For Trade';

    return (
      <View ref={ref} style={styles.card}>
        {/* ── Header ── */}
        <LinearGradient
          colors={[AMBER.mid, AMBER.darkest]}
          style={styles.header}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.headerTop}>
            <View style={styles.headerIconWrap}>
              <Ionicons name="pricetag" size={14} color="rgba(255,255,255,0.7)" />
              <Text style={styles.headerTag}>PEDALS</Text>
            </View>
            {username && (
              <Text style={styles.headerUser}>@{username}</Text>
            )}
          </View>
          <Text style={styles.headerHeadline}>{headline.toUpperCase()}</Text>
          <Text style={styles.headerSub}>DMs open — serious inquiries only</Text>
        </LinearGradient>

        {/* ── Pedal rows ── */}
        <View style={styles.body}>
          {shown.map((p, i) => {
            const isFS =
              p.listing_status === 'for_sale' ||
              p.listing_status === 'for_sale_or_trade';
            const isFT =
              p.listing_status === 'for_trade' ||
              p.listing_status === 'for_sale_or_trade';

            return (
              <View
                key={`${p.brand}-${p.model}-${i}`}
                style={[styles.row, i > 0 && styles.rowBorder]}
              >
                {/* Left: brand + model */}
                <View style={styles.rowInfo}>
                  <Text style={styles.rowBrand} numberOfLines={1}>
                    {p.brand}
                  </Text>
                  <Text style={styles.rowModel} numberOfLines={1}>
                    {p.model}
                  </Text>
                </View>

                {/* Right: badges */}
                <View style={styles.rowBadges}>
                  {isFS && (
                    <View style={styles.fsBadge}>
                      <Text style={styles.fsBadgeText}>
                        {p.asking_price != null
                          ? `$${p.asking_price}`
                          : 'FS'}
                      </Text>
                    </View>
                  )}
                  {isFT && (
                    <View style={styles.ftBadge}>
                      <Text style={styles.ftBadgeText}>FT</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}

          {extra > 0 && (
            <Text style={styles.extraText}>+{extra} more</Text>
          )}
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            {/* TPC logomark */}
            <View style={styles.logomark}>
              <View style={styles.logoPink} />
              <View style={styles.logoTeal}>
                <Text style={styles.logoText}>TPC</Text>
              </View>
            </View>
            <View>
              <Text style={styles.footerBrand}>The Pedal Collaborative</Text>
              <Text style={styles.footerUrl}>thepedalcollaborative.com</Text>
            </View>
          </View>
          <View style={styles.footerHashRow}>
            <Text style={styles.footerHash}>#guitarpedals</Text>
            <Text style={styles.footerHash}>#geartrade</Text>
          </View>
        </View>
      </View>
    );
  },
);

FsftShareCard.displayName = 'FsftShareCard';

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    backgroundColor: '#1C1009',
    borderRadius: 16,
    overflow: 'hidden',
  },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    gap: 4,
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
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  headerUser: {
    fontSize: 11,
    fontFamily: typography.bodyMedium,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.3,
  },
  headerHeadline: {
    fontSize: 28,
    fontFamily: typography.display,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },

  // Pedal rows
  body: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  rowInfo: {
    flex: 1,
  },
  rowBrand: {
    fontSize: 10,
    fontFamily: typography.bodyMedium,
    color: '#C4A97D',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  rowModel: {
    fontSize: 15,
    fontFamily: typography.bodySemiBold,
    color: '#FFFFFF',
    marginTop: 1,
  },
  rowBadges: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  fsBadge: {
    backgroundColor: AMBER.mid,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 40,
    alignItems: 'center',
  },
  fsBadgeText: {
    fontSize: 12,
    fontFamily: typography.bodySemiBold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  ftBadge: {
    backgroundColor: TEAL_BRIGHT,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 32,
    alignItems: 'center',
  },
  ftBadgeText: {
    fontSize: 12,
    fontFamily: typography.bodySemiBold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  extraText: {
    fontSize: 12,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.4)',
    paddingTop: 10,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },

  // Footer
  footer: {
    backgroundColor: '#120D05',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 8,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logomark: {
    width: 32,
    height: 32,
    position: 'relative',
  },
  logoPink: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 4,
    height: '100%',
    backgroundColor: '#F26080',
    borderRadius: 2,
  },
  logoTeal: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 0,
    bottom: 0,
    backgroundColor: '#2D8A7E',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 8,
    fontFamily: typography.display,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  footerBrand: {
    fontSize: 12,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.8)',
  },
  footerUrl: {
    fontSize: 10,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 1,
  },
  footerHashRow: {
    flexDirection: 'row',
    gap: 10,
  },
  footerHash: {
    fontSize: 10,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.25)',
  },
});
