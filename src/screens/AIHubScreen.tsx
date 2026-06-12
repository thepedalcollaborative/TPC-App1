/**
 * AIHubScreen — Unified AI tab entry point
 *
 * Two cards:
 *   1. Custom Shop — AI expert pedal picker (ExpertMode / FinderScreen)
 *   2. Advisor    — open-ended AI chat about tone, gear, technique
 *
 * Navigates within the AIStack (AIHub → Advisor / Finder).
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Linking,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';
import { useStore } from '../hooks/useStore';
import { AIStackParamList } from '../types/navigation';
import { HiddenShareCard } from '../components/ShareCard';
import { useShareCard } from '../lib/useShareCard';
import { hasBetaFullAccess } from '../lib/subscription';
import { reverbSearchUrl } from '../lib/reverb';
import { weeklyPickCountdownLabel } from '../lib/notifications';
import { SwipeDismissSheet } from '../components/SwipeDismissSheet';

type Nav = NativeStackNavigationProp<AIStackParamList>;

// ─── Feature card data ────────────────────────────────────────────────────────
type Feature = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  badge?: string;
};

const CUSTOM_SHOP_FEATURES: Feature[] = [
  { key: 'a', icon: 'sparkles-outline',     label: 'Tailored to your rig',      description: 'Pulls from your owned pedals, GAS list & retired gear' },
  { key: 'b', icon: 'person-outline',       label: 'Knows your tone',            description: 'Uses your style profile to narrow the field' },
  { key: 'c', icon: 'trending-up-outline',  label: 'Interview-driven picks',    description: '4 quick questions sharpen the recommendation' },
];

const ADVISOR_FEATURES: Feature[] = [
  { key: 'a', icon: 'chatbubble-ellipses-outline', label: 'Ask anything',       description: 'Gear questions, dialing in tones, signal chain help' },
  { key: 'b', icon: 'musical-notes-outline',       label: 'Artist sounds',      description: '"How do I get that SRV tone?" — it knows' },
  { key: 'c', icon: 'bulb-outline',                label: 'Rig suggestions',    description: 'Based on your collection and goals' },
];

// ─── Single hub card ──────────────────────────────────────────────────────────
function HubCard({
  gradient,
  badge,
  title,
  subtitle,
  features,
  cta,
  onPress,
  isPro,
  freeLabel,
}: {
  gradient: [string, string];
  badge: string;
  title: string;
  subtitle: string;
  features: Feature[];
  cta: string;
  onPress: () => void;
  isPro: boolean;
  freeLabel?: string;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88}>
      <LinearGradient colors={gradient} style={styles.card}>
        {/* Badge row */}
        <View style={styles.cardBadgeRow}>
          <View style={styles.cardBadge}>
            <Text style={styles.cardBadgeText}>{badge}</Text>
          </View>
          {!isPro && freeLabel && (
            <View style={styles.freeChip}>
              <Text style={styles.freeChipText}>{freeLabel}</Text>
            </View>
          )}
          {isPro && (
            <View style={styles.proChip}>
              <Text style={styles.proChipText}>✦ PRO</Text>
            </View>
          )}
        </View>

        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>

        {/* Feature list */}
        <View style={styles.featureList}>
          {features.map(f => (
            <View key={f.key} style={styles.featureRow}>
              <Ionicons name={f.icon} size={15} color="rgba(255,255,255,0.7)" />
              <Text style={styles.featureText}>{f.description}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <View style={styles.cardCta}>
          <Text style={styles.cardCtaText}>{cta}</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Weekly Pick card ─────────────────────────────────────────────────────────
function WeeklyPickCard({
  isPro,
  pick,
  loading,
  onOpenPaywall,
  onShare,
  onTap,
}: {
  isPro: boolean;
  pick: { brand: string; model: string; why: string; weekKey: string } | null;
  loading: boolean;
  onOpenPaywall: () => void;
  onShare: () => void;
  onTap: () => void;
}) {
  const countdown = weeklyPickCountdownLabel();

  // Free teaser — FOMO driver
  if (!isPro) {
    return (
      <TouchableOpacity onPress={onOpenPaywall} activeOpacity={0.88}>
        <LinearGradient colors={['#2A2010', '#1A1500']} style={styles.weeklyCard}>
          <View style={styles.cardBadgeRow}>
            <View style={styles.cardBadge}>
              <Text style={styles.cardBadgeText}>✦ WEEKLY PICK</Text>
            </View>
            <View style={styles.proChip}>
              <Text style={styles.proChipText}>PRO ONLY</Text>
            </View>
          </View>
          <View style={styles.weeklyLocked}>
            <Ionicons name="lock-closed" size={28} color={colors.gold + 'AA'} />
            <Text style={styles.weeklyLockedTitle}>Your pick is ready</Text>
            <Text style={styles.weeklyLockedSub}>
              Pro members get a fresh AI recommendation every Monday.
            </Text>
            <View style={styles.weeklyLockedCta}>
              <Text style={styles.weeklyLockedCtaText}>Unlock TPC Pro →</Text>
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  // Pro + loading
  if (loading && !pick) {
    return (
      <LinearGradient colors={[colors.gold, colors.goldDark]} style={styles.weeklyCard}>
        <View style={styles.cardBadgeRow}>
          <View style={styles.cardBadge}>
            <Text style={styles.cardBadgeText}>✦ WEEKLY PICK</Text>
          </View>
          <View style={styles.proChip}>
            <Text style={styles.proChipText}>✦ PRO</Text>
          </View>
        </View>
        <View style={styles.weeklyLoading}>
          <ActivityIndicator color="rgba(255,255,255,0.8)" />
          <Text style={styles.weeklyLoadingText}>Crafting this week's pick…</Text>
        </View>
      </LinearGradient>
    );
  }

  // Pro + pick ready
  if (pick) {
    return (
      <TouchableOpacity onPress={onTap} activeOpacity={0.88}>
        <LinearGradient colors={[colors.gold, colors.goldDark]} style={styles.weeklyCard}>
          <View style={styles.cardBadgeRow}>
            <View style={styles.cardBadge}>
              <Text style={styles.cardBadgeText}>✦ THIS WEEK'S PICK</Text>
            </View>
            <View style={styles.proChip}>
              <Text style={styles.proChipText}>✦ PRO</Text>
            </View>
          </View>
          <Text style={styles.weeklyBrand}>{pick.brand}</Text>
          <Text style={styles.weeklyModel}>{pick.model}</Text>
          <Text style={styles.weeklyWhy}>{pick.why}</Text>
          <View style={styles.weeklyActions}>
            <View style={styles.weeklyCountdownChip}>
              <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.7)" />
              <Text style={styles.weeklyCountdownText}>{countdown}</Text>
            </View>
            <TouchableOpacity style={styles.weeklyShareBtn} onPress={onShare} activeOpacity={0.8}>
              <Ionicons name="share-social-outline" size={15} color={colors.goldDark} />
              <Text style={styles.weeklyShareText}>Share</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function AIHubScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { profile, lastCustomShopPick, weeklyPick, weeklyPickLoading, fetchWeeklyPick, openPaywall, addToWishlist } = useStore();
  const { cardRef: weeklyCardRef, cardData: weeklyCardData, triggerShare: triggerWeeklyShare } = useShareCard();

  const isPro = Boolean(profile?.is_premium) || hasBetaFullAccess();
  const hasProfile = Boolean(profile?.pedal_expert_profile?.onboarding_completed_at);

  const [showWeeklyDetail, setShowWeeklyDetail] = useState(false);
  const [weeklyWishlistState, setWeeklyWishlistState] = useState<'idle' | 'loading' | 'added' | 'exists'>('idle');

  // Fetch weekly pick when screen mounts (Pro users only — gated inside fetchWeeklyPick)
  useEffect(() => {
    fetchWeeklyPick();
  }, [isPro]);

  const goToCustomShop = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('Finder');
  };

  const goToAdvisor = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('Advisor');
  };

  const lastPickLine = lastCustomShopPick
    ? `Last pick: ${lastCustomShopPick.brand} ${lastCustomShopPick.model}`
    : hasProfile
    ? 'Your profile is ready — get your pick'
    : 'Build your tone profile for better picks';

  return (
    <>
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>TPC.ai</Text>
        <Text style={styles.headerSub}>Expert tools powered by Claude</Text>
      </View>

      {/* Weekly Pick card — top slot, above the two main feature cards */}
      <WeeklyPickCard
        isPro={isPro}
        pick={weeklyPick}
        loading={weeklyPickLoading}
        onOpenPaywall={() => openPaywall('weekly_pick')}
        onShare={() => {
          if (!weeklyPick) return;
          Haptics.selectionAsync();
          triggerWeeklyShare({ type: 'weekly', brand: weeklyPick.brand, model: weeklyPick.model, why: weeklyPick.why });
        }}
        onTap={() => {
          if (!weeklyPick) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setWeeklyWishlistState('idle');
          setShowWeeklyDetail(true);
        }}
      />

      {/* Custom Shop card */}
      <HubCard
        gradient={gradients.teal}
        badge="✦ CUSTOM SHOP"
        title="Feed Your GAS"
        subtitle={lastPickLine}
        features={CUSTOM_SHOP_FEATURES}
        cta={lastCustomShopPick ? 'Feed Your GAS Again' : 'Feed Your GAS'}
        onPress={goToCustomShop}
        isPro={isPro}
        freeLabel="1 FREE"
      />

      {/* Advisor card */}
      <HubCard
        gradient={['#3D5261', '#2A3E4E']}
        badge="AI ADVISOR"
        title="Ask the Advisor"
        subtitle="Your personal tone consultant — always on"
        features={ADVISOR_FEATURES}
        cta="Start Chatting"
        onPress={goToAdvisor}
        isPro={isPro}
        freeLabel="3 FREE TRIAL"
      />

      {/* Pro upsell strip */}
      {!isPro && (
        <View style={styles.proStrip}>
          <Ionicons name="sparkles" size={14} color={colors.gold} />
          <Text style={styles.proStripText}>
            TPC Pro unlocks unlimited picks, unlimited chat, and weekly AI recommendations
          </Text>
        </View>
      )}
    </ScrollView>
    <HiddenShareCard cardRef={weeklyCardRef} cardData={weeklyCardData} />

    {/* ── Weekly Pick detail sheet ── */}
    {weeklyPick && (
      <Modal
        visible={showWeeklyDetail}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWeeklyDetail(false)}
      >
        <View style={styles.detailOverlay}>
          <TouchableOpacity style={styles.detailBackdrop} activeOpacity={1} onPress={() => setShowWeeklyDetail(false)} />
          <SwipeDismissSheet style={[styles.detailSheet, { paddingBottom: insets.bottom + 24 }]} onDismiss={() => setShowWeeklyDetail(false)}>
            {/* Header */}
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleRow}>
                <Ionicons name="sparkles" size={15} color={colors.gold} />
                <Text style={styles.detailTitle}>This Week's Pick</Text>
              </View>
              <TouchableOpacity onPress={() => setShowWeeklyDetail(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.detailPedal}>{weeklyPick.brand} {weeklyPick.model}</Text>
            {weeklyPick.category && (
              <Text style={styles.detailCategory}>{weeklyPick.category}</Text>
            )}
            <Text style={styles.detailCountdown}>{weeklyPickCountdownLabel()}</Text>

            <Text style={styles.detailWhyLabel}>Why this pedal?</Text>
            <Text style={styles.detailWhy}>{weeklyPick.why}</Text>

            <View style={styles.detailActions}>
              <TouchableOpacity
                style={styles.detailBtnReverb}
                activeOpacity={0.8}
                onPress={() => Linking.openURL(reverbSearchUrl(`${weeklyPick.brand} ${weeklyPick.model}`))}
              >
                <Ionicons name="storefront-outline" size={16} color="#fff" />
                <Text style={styles.detailBtnReverbText}>See on Reverb</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.detailBtnWishlist, weeklyWishlistState !== 'idle' && styles.detailBtnWishlistDone]}
                activeOpacity={0.8}
                disabled={weeklyWishlistState !== 'idle'}
                onPress={async () => {
                  setWeeklyWishlistState('loading');
                  const result = await addToWishlist(weeklyPick.brand, weeklyPick.model, {
                    category: weeklyPick.category ?? 'other',
                    subcategory: 'Weekly Pick',
                    description: weeklyPick.why ?? '',
                    analog: false,
                    price: null,
                  });
                  if (result === 'added') {
                    setWeeklyWishlistState('added');
                  } else if (result === 'exists') {
                    setWeeklyWishlistState('exists');
                  } else if (result === 'not_found') {
                    setWeeklyWishlistState('idle');
                    Alert.alert('Not in catalog yet', 'Could not add this pick right now. Please try again in a moment.');
                  } else {
                    setWeeklyWishlistState('idle');
                    Alert.alert('Could not add', 'Please try again in a moment.');
                  }
                }}
              >
                {weeklyWishlistState === 'loading' ? (
                  <ActivityIndicator size="small" color={colors.teal} />
                ) : weeklyWishlistState === 'added' ? (
                  <>
                    <Ionicons name="checkmark-circle" size={16} color={colors.teal} />
                    <Text style={styles.detailBtnWishlistText}>Added to Wishlist</Text>
                  </>
                ) : weeklyWishlistState === 'exists' ? (
                  <>
                    <Ionicons name="checkmark-circle" size={16} color={colors.textMuted} />
                    <Text style={[styles.detailBtnWishlistText, { color: colors.textMuted }]}>Already on Wishlist</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="bookmark-outline" size={16} color={colors.teal} />
                    <Text style={styles.detailBtnWishlistText}>Add to Wishlist</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </SwipeDismissSheet>
        </View>
      </Modal>
    )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.base,
    gap: spacing.base,
  },
  header: {
    marginBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  headerSub: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Hub cards
  card: {
    borderRadius: radius.xl,
    padding: spacing.base,
    gap: spacing.sm,
  },
  cardBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardBadge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  cardBadgeText: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
    letterSpacing: 1,
  },
  freeChip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  freeChipText: {
    fontSize: 8,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 0.5,
  },
  proChip: {
    backgroundColor: colors.gold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  proChipText: {
    fontSize: 8,
    fontFamily: typography.bodySemiBold,
    color: '#1A1A1A',
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: '#fff',
    lineHeight: 26,
  },
  cardSubtitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 18,
  },
  featureList: {
    gap: 6,
    marginTop: spacing.xs,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.75)',
    flex: 1,
    lineHeight: 18,
  },
  cardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  cardCtaText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },

  // Weekly Pick card
  weeklyCard: {
    borderRadius: radius.xl,
    padding: spacing.base,
    gap: spacing.sm,
  },
  weeklyBrand: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: '#fff',
    opacity: 0.85,
    marginTop: spacing.xs,
  },
  weeklyModel: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: '#fff',
    lineHeight: 30,
    marginTop: -4,
  },
  weeklyWhy: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  weeklyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  weeklyCountdownChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  weeklyCountdownText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.65)',
  },
  weeklyShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: '#fff',
  },
  weeklyShareText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.goldDark,
  },
  weeklyLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  weeklyLoadingText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.7)',
  },
  weeklyLocked: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  weeklyLockedTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.gold,
  },
  weeklyLockedSub: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 18,
  },
  weeklyLockedCta: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.gold + '22',
    borderWidth: 1,
    borderColor: colors.gold + '44',
  },
  weeklyLockedCtaText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.gold,
  },

  // Weekly Pick detail modal
  detailOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  detailBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  detailSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  detailHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailTitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.gold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  detailPedal: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: colors.textPrimary,
    lineHeight: 32,
  },
  detailCategory: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: -spacing.xs,
  },
  detailCountdown: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.gold,
    letterSpacing: 0.3,
  },
  detailWhyLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  detailWhy: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  detailActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  detailBtnReverb: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#E25B45',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  detailBtnReverbText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  detailBtnWishlist: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1.5,
    borderColor: colors.teal,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(43,181,160,0.06)',
  },
  detailBtnWishlistDone: {
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  detailBtnWishlistText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },

  // Pro strip
  proStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gold + '44',
    padding: spacing.md,
  },
  proStripText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
