export { ExpertMode } from './ExpertMode';
export { PlayerOnboarding } from './PlayerOnboarding';
export { ToneProfileEditor } from './ToneProfileEditor';
export { PostOnboardingScreen } from './PostOnboardingScreen';

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, categoryColors } from '../theme';
import { UserPedal } from '../lib/supabase';

// ─── TPCCard ──────────────────────────────────────────────────────────────────
// Generic card container with surface background and border
type TPCCardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
};

export function TPCCard({ children, style, onPress }: TPCCardProps) {
  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.card, style]}
        onPress={onPress}
        activeOpacity={0.75}
      >
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
type StatCardProps = {
  label: string;
  value: number | string;
  accent?: string;
};

export function StatCard({ label, value, accent = colors.teal }: StatCardProps) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── CategoryBadge ────────────────────────────────────────────────────────────
type CategoryBadgeProps = {
  category: string;
  small?: boolean;
};

export function CategoryBadge({ category, small }: CategoryBadgeProps) {
  const color = categoryColors[category] ?? colors.textMuted;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: color + '22', borderColor: color + '55' },
        small && styles.badgeSmall,
      ]}
    >
      <Text style={[styles.badgeText, { color }, small && styles.badgeTextSmall]}>
        {category.toUpperCase()}
      </Text>
    </View>
  );
}

// ─── PedalCard ────────────────────────────────────────────────────────────────
// Full-width card for collection lists
type PedalCardProps = {
  userPedal: UserPedal;
  retired?: boolean;
  marketValue?: number;
  imageUrlOverride?: string;
  viewMode?: 'tile' | 'text';
  boardColors?: string[];
  onPress?: () => void;
  onLongPress?: () => void;
};

export function PedalCard({ userPedal, retired = false, marketValue, imageUrlOverride, viewMode = 'tile', boardColors, onPress, onLongPress }: PedalCardProps) {
  const pedal = userPedal.pedal;
  if (!pedal) return null;
  const imageUrl = imageUrlOverride ?? userPedal.colorway?.image_url ?? pedal.image_url;
  const displayCategory = userPedal.category_override ?? pedal.category;
  const stripColor = retired
    ? colors.textMuted
    : (categoryColors[displayCategory] ?? colors.textMuted);

  const isOwned = userPedal.status === 'owned';
  const isWishlist = userPedal.status === 'wishlist';

  const paidOrTarget = isOwned || retired
    ? userPedal.purchase_price
    : userPedal.target_price;

  // Fallback to avg_price only when no market value available
  const displayPrice = marketValue != null
    ? null
    : (paidOrTarget ?? pedal.avg_price);

  const delta = isOwned && marketValue != null && userPedal.purchase_price != null
    ? Math.round(marketValue - userPedal.purchase_price)
    : null;

  // Wishlist price-drop intelligence
  // Target can be user's set target price OR the catalog avg_price as fallback
  const effectiveTarget = userPedal.target_price ?? pedal.avg_price ?? null;
  const wishlistDrop = isWishlist && marketValue != null && effectiveTarget != null
    ? Math.round(effectiveTarget - marketValue)   // positive = market below target
    : null;
  const isUnderBudget = wishlistDrop !== null && wishlistDrop >= 0;
  const isNearBudget  = wishlistDrop !== null && wishlistDrop < 0
    && effectiveTarget != null
    && Math.abs(wishlistDrop) / effectiveTarget < 0.12; // within 12%

  const modelInitial = (pedal.model?.trim()?.[0] ?? '?').toUpperCase();
  const boardDots = (boardColors ?? []).slice(0, 3);
  const extraBoardCount = Math.max((boardColors?.length ?? 0) - boardDots.length, 0);

  return (
    <TouchableOpacity
      style={[styles.pedalCard, retired && styles.pedalCardRetired]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.75}
    >
      {/* Category color strip */}
      <View style={[styles.pedalCardStrip, { backgroundColor: stripColor }]} />

      {/* Pedal image / fallback */}
      {viewMode === 'tile' && imageUrl ? (
        <View style={styles.pedalCardImageWrap}>
          <Image
            source={{ uri: imageUrl }}
            style={[styles.pedalCardImage, retired && styles.pedalCardImageRetired]}
            resizeMode="cover"
          />
        </View>
      ) : (
        <View
          style={[
            styles.pedalCardImageFallback,
            { backgroundColor: stripColor + '18', borderColor: stripColor + '55' },
            viewMode === 'text' && styles.pedalCardLetterWrap,
          ]}
        >
          {viewMode === 'text' ? (
            <Text style={[styles.pedalCardLetter, { color: stripColor }]}>{modelInitial}</Text>
          ) : (
            <Ionicons name="hardware-chip-outline" size={22} color={stripColor} style={{ opacity: retired ? 0.4 : 0.7 }} />
          )}
        </View>
      )}

      <View style={styles.pedalCardContent}>
        <View style={styles.pedalCardTop}>
          <View style={styles.pedalCardInfo}>
            <Text style={[styles.pedalBrand, retired && styles.textRetired]}>{pedal.brand}</Text>
            <View style={styles.pedalModelRow}>
              {boardDots.length > 0 && (
                <View style={styles.boardDotsRow}>
                  {boardDots.map((c, i) => (
                    <View key={`${c}-${i}`} style={[styles.boardDot, { backgroundColor: c }]} />
                  ))}
                  {extraBoardCount > 0 && (
                    <Text style={styles.boardDotMore}>+{extraBoardCount}</Text>
                  )}
                </View>
              )}
              <Text style={[styles.pedalModel, retired && styles.textRetired]} numberOfLines={1}>
                {pedal.model}
              </Text>
            </View>
          </View>
          <View style={styles.pedalCardRight}>
            {retired ? (
              <View style={styles.retiredBadge}>
                <Text style={styles.retiredBadgeText}>PREVIOUS</Text>
              </View>
            ) : (
              <>
                {marketValue != null ? (
                  <>
                    <Text style={styles.pedalPrice}>~${Math.round(marketValue).toLocaleString()}</Text>
                    {paidOrTarget != null && (
                      <Text style={styles.pedalPriceSub}>
                        {isWishlist ? 'Target' : 'Paid'} ${paidOrTarget.toLocaleString()}
                      </Text>
                    )}
                  </>
                ) : (
                  displayPrice != null && (
                    <Text style={styles.pedalPrice}>${displayPrice.toLocaleString()}</Text>
                  )
                )}
                {isOwned && userPedal.condition && (
                  <Text style={styles.pedalCondition}>{userPedal.condition}</Text>
                )}
              </>
            )}
          </View>
        </View>

        <View style={styles.pedalCardBottom}>
          <CategoryBadge category={displayCategory} small />
          {pedal.analog && !retired && (
            <View style={styles.analogBadge}>
              <Text style={styles.analogBadgeText}>ANALOG</Text>
            </View>
          )}
          {retired && userPedal.retired_date && (
            <Text style={styles.retiredDate}>
              Retired {new Date(userPedal.retired_date).getFullYear()}
            </Text>
          )}
          {delta != null && (
            <Text style={[styles.marketDelta, delta >= 0 ? styles.marketGain : styles.marketLoss]}>
              {delta >= 0 ? '+' : ''}${delta.toLocaleString()}
            </Text>
          )}
          {/* Wishlist price-drop badge */}
          {isUnderBudget && (
            <View style={styles.priceDropBadge}>
              <Text style={styles.priceDropText}>✓ UNDER TARGET</Text>
            </View>
          )}
          {!isUnderBudget && isNearBudget && (
            <View style={styles.priceNearBadge}>
              <Text style={styles.priceNearText}>↓ NEAR TARGET</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── MiniPedalCard ────────────────────────────────────────────────────────────
// Compact horizontal-scroll card used on HomeScreen
type MiniPedalCardProps = {
  userPedal: UserPedal;
  imageUrlOverride?: string;
  viewMode?: 'tile' | 'text';
  boardColors?: string[];
  onPress?: () => void;
};

export function MiniPedalCard({ userPedal, imageUrlOverride, viewMode = 'tile', boardColors, onPress }: MiniPedalCardProps) {
  const [imageError, setImageError] = useState(false);
  const pedal = userPedal.pedal;
  if (!pedal) return null;
  const displayCategory = userPedal.category_override ?? pedal.category;
  const color = categoryColors[displayCategory] ?? colors.textMuted;
  const primaryImageUrl = imageUrlOverride ?? userPedal.colorway?.image_url ?? pedal.image_url;
  const imageUrl = imageError ? pedal.image_url : primaryImageUrl;
  const modelInitial = (pedal.model?.trim()?.[0] ?? '?').toUpperCase();
  const boardDots = (boardColors ?? []).slice(0, 3);
  const extraBoardCount = Math.max((boardColors?.length ?? 0) - boardDots.length, 0);

  if (__DEV__ && imageUrl) {
    console.log('[TPC] MiniPedalCard image', {
      pedalId: pedal.id,
      brand: pedal.brand,
      model: pedal.model,
      imageUrl,
    });
  }

  return (
    <TouchableOpacity
      style={styles.miniCard}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {viewMode === 'tile' && imageUrl ? (
        <View style={styles.miniCardImageWrap}>
          <Image
            source={{ uri: imageUrl }}
            style={styles.miniCardImage}
            resizeMode="cover"
            onError={(e) => {
              if (__DEV__) {
                console.warn('[TPC] MiniPedalCard image error', {
                  pedalId: pedal.id,
                  imageUrl,
                  error: e.nativeEvent,
                });
              }
              // Fall back to catalog image if user override or colorway image fails
              if (!imageError && imageUrl !== pedal.image_url) setImageError(true);
            }}
            onLoadEnd={() => {
              if (__DEV__) {
                console.log('[TPC] MiniPedalCard image load end', {
                  pedalId: pedal.id,
                  imageUrl,
                });
              }
            }}
          />
        </View>
      ) : (
        <View style={[styles.miniCardTop, { backgroundColor: color + '22', borderColor: color + '55' }, viewMode === 'text' && styles.miniCardLetterWrap]}>
          {viewMode === 'text' ? (
            <Text style={[styles.miniCardLetter, { color }]}>{modelInitial}</Text>
          ) : (
            <Ionicons name="hardware-chip-outline" size={26} color={color} style={{ opacity: 0.7 }} />
          )}
          {__DEV__ && viewMode === 'tile' && (
            <Text style={styles.miniCardDebug}>No image_url</Text>
          )}
        </View>
      )}
      <View style={styles.miniCardBody}>
        <Text style={styles.miniCardBrand} numberOfLines={1}>{pedal.brand}</Text>
        <View style={styles.miniCardModelRow}>
          {boardDots.length > 0 && (
            <View style={styles.boardDotsRow}>
              {boardDots.map((c, i) => (
                <View key={`${c}-${i}`} style={[styles.boardDot, { backgroundColor: c }]} />
              ))}
              {extraBoardCount > 0 && (
                <Text style={styles.boardDotMore}>+{extraBoardCount}</Text>
              )}
            </View>
          )}
          <Text style={styles.miniCardModel} numberOfLines={2}>{pedal.model}</Text>
        </View>
        <CategoryBadge category={displayCategory} small />
      </View>
    </TouchableOpacity>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────
type SectionHeaderProps = {
  title: string;
  action?: string;
  onAction?: () => void;
  style?: ViewStyle;
};

export function SectionHeader({ title, action, onAction, style }: SectionHeaderProps) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onAction && (
        <TouchableOpacity onPress={onAction}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────
type EmptyStateProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  emoji?: string;
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  compact?: boolean;
};

export function EmptyState({ icon, emoji, title, subtitle, action, onAction, compact }: EmptyStateProps) {
  return (
    <View style={[styles.emptyState, compact && styles.emptyStateCompact]}>
      {!compact && (
        <View style={styles.emptyIconWrap}>
          {emoji ? (
            <Text style={styles.emptyEmoji}>{emoji}</Text>
          ) : icon ? (
            <Ionicons name={icon} size={32} color={colors.textMuted} />
          ) : null}
        </View>
      )}
      <Text style={[styles.emptyTitle, compact && styles.emptyTitleCompact]}>{title}</Text>
      {subtitle && <Text style={[styles.emptySubtitle, compact && styles.emptySubtitleCompact]}>{subtitle}</Text>}
      {action && onAction && (
        <TouchableOpacity style={styles.emptyAction} onPress={onAction} activeOpacity={0.8}>
          <LinearGradient
            colors={[colors.teal, colors.tealDark]}
            style={styles.emptyActionGradient}
          >
            <Text style={styles.emptyActionText}>{action}</Text>
          </LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── TPCLogoMark ──────────────────────────────────────────────────────────────
// The iconic TPC logo: teal box + rose accents + "TPC" text
type TPCLogoMarkProps = {
  size?: number;
};

export function TPCLogoMark({ size = 56 }: TPCLogoMarkProps) {
  const accentThick = Math.round(size * 0.1);
  const innerPad = Math.round(size * 0.07);
  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: accentThick,
          height: '100%',
          backgroundColor: colors.rose,
          borderRadius: radius.sm,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: accentThick,
          backgroundColor: colors.rose,
          borderRadius: radius.sm,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: innerPad,
          left: innerPad,
          right: 0,
          bottom: 0,
          backgroundColor: colors.teal,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: size * 0.28,
            fontFamily: typography.display,
            color: '#fff',
            letterSpacing: 1.5,
          }}
        >
          TPC
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // TPCCard
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  // StatCard
  statCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  statValue: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
  },
  statLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // CategoryBadge
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    letterSpacing: 0.4,
  },
  badgeTextSmall: {
    fontSize: 9,
  },

  // PedalCard
  pedalCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  pedalCardRetired: {
    backgroundColor: colors.surfaceHigh,
    opacity: 0.65,
  },
  pedalCardStrip: {
    width: 4,
  },
  pedalCardImage: {
    width: 72,
    height: 72,
  },
  pedalCardImageWrap: {
    width: 72,
    height: 72,
  },
  pedalCardImageRetired: {
    opacity: 0.5,
  },
  pedalCardImageFallback: {
    width: 72,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pedalCardLetterWrap: {
    width: 72,
  },
  pedalCardLetter: {
    fontSize: 26,
    fontFamily: typography.display,
  },
  pedalCardContent: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  textRetired: {
    color: colors.textMuted,
  },
  retiredBadge: {
    backgroundColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  retiredBadgeText: {
    fontSize: 9,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 0.4,
  },
  retiredDate: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  pedalCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pedalCardInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  pedalBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pedalModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pedalModel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    marginTop: 2,
  },
  pedalCardRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  pedalPrice: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  pedalCondition: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  pedalPriceSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  marketDelta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    marginLeft: 'auto',
  },
  marketGain: {
    color: colors.teal,
  },
  marketLoss: {
    color: colors.rose,
  },
  // Wishlist price-drop indicators
  priceDropBadge: {
    backgroundColor: colors.success + '18',
    borderWidth: 1,
    borderColor: colors.success + '55',
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  priceDropText: {
    fontSize: 9,
    fontFamily: typography.bodySemiBold,
    color: colors.success,
    letterSpacing: 0.3,
  },
  priceNearBadge: {
    backgroundColor: colors.warning + '18',
    borderWidth: 1,
    borderColor: colors.warning + '55',
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  priceNearText: {
    fontSize: 9,
    fontFamily: typography.bodySemiBold,
    color: colors.warning,
    letterSpacing: 0.3,
  },
  pedalCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  analogBadge: {
    backgroundColor: colors.warning + '22',
    borderWidth: 1,
    borderColor: colors.warning + '55',
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  analogBadgeText: {
    fontSize: 9,
    fontFamily: typography.bodySemiBold,
    color: colors.warning,
    letterSpacing: 0.4,
  },

  // MiniPedalCard
  miniCard: {
    width: 130,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginRight: spacing.md,
  },
  miniCardImage: {
    width: '100%',
    height: 80,
  },
  miniCardImageWrap: {
    width: '100%',
    height: 80,
  },
  miniCardTop: {
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  boardDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  boardDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  boardDotMore: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    marginLeft: 2,
  },
  miniCardLetterWrap: {
    borderWidth: 1,
  },
  miniCardLetter: {
    fontSize: 30,
    fontFamily: typography.display,
  },
  miniCardDebug: {
    marginTop: 6,
    fontSize: 10,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  miniCardBody: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  miniCardBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  miniCardModel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    lineHeight: 17,
  },
  miniCardModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  // SectionHeader
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  sectionAction: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },

  // EmptyState
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyStateCompact: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  emptyTitleCompact: {
    fontSize: typography.sizes.sm,
  },
  emptySubtitleCompact: {
    fontSize: typography.sizes.xs,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyEmoji: {
    fontSize: 32,
  },
  emptyTitle: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyAction: {
    marginTop: spacing.sm,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  emptyActionGradient: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  emptyActionText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
});
