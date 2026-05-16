/**
 * PaywallScreen — TPC Pro upgrade modal
 *
 * Shown as a full-screen modal from anywhere via useStore().openPaywall(reason).
 * Reason customizes the headline and hero copy.
 *
 * Usage:
 *   const { openPaywall } = useStore();
 *   openPaywall('advisor');   // or 'custom_shop' | 'boards' | 'weekly_pick'
 */

import React, { useState, useEffect } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Image,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';
import {
  PRICE_MONTHLY,
  PRICE_ANNUAL,
  PRICE_ANNUAL_MONTHLY,
  PRICE_ANNUAL_SAVINGS,
  fetchLivePrices,
  purchasePro,
  restorePurchases,
} from '../lib/subscription';
import { useStore } from '../hooks/useStore';

export type PaywallReason = 'advisor' | 'custom_shop' | 'boards' | 'weekly_pick' | 'general';

const tpcSquare = require('../../assets/tpc-square.png');

const HERO_COPY: Record<PaywallReason, { headline: string; sub: string }> = {
  advisor: {
    headline: "You've found your flow.",
    sub:      "You've hit your free message limit for this month. Keep the conversation going.",
  },
  custom_shop: {
    headline: "Your pick is ready.",
    sub:      "You've already seen what TPC can do. Unlock unlimited expert picks.",
  },
  boards: {
    headline: "Expand your rig.",
    sub:      "You've hit the free board limit. Build as many as you want.",
  },
  weekly_pick: {
    headline: "Your weekly pick is in.",
    sub:      "Pro members get a fresh AI recommendation every week.",
  },
  general: {
    headline: "Unlock everything.",
    sub:      "Get the most out of TPC with unlimited AI, boards, and weekly picks.",
  },
};

const FEATURES = [
  { icon: 'sparkles-outline',           text: 'Unlimited Custom Shop expert picks' },
  { icon: 'chatbubble-ellipses-outline', text: 'Unlimited AI Advisor sessions' },
  { icon: 'albums-outline',             text: 'Unlimited pedalboards' },
  { icon: 'refresh-outline',            text: 'Weekly AI sound recommendations' },
  { icon: 'flash-outline',              text: 'Early access to new features' },
];

type PaywallScreenProps = {
  visible: boolean;
  reason: PaywallReason;
  onClose: () => void;
};

export default function PaywallScreen({ visible, reason, onClose }: PaywallScreenProps) {
  const insets      = useSafeAreaInsets();
  const { session, fetchProfile } = useStore();
  const [plan, setPlan]       = useState<'monthly' | 'annual'>('annual');
  const [loading, setLoading]   = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Live prices from StoreKit via RevenueCat — fall back to constants in Expo Go
  const [priceMonthly, setPriceMonthly]           = useState(PRICE_MONTHLY);
  const [priceAnnual, setPriceAnnual]             = useState(PRICE_ANNUAL);
  const [priceAnnualMonthly, setPriceAnnualMonthly] = useState(PRICE_ANNUAL_MONTHLY);
  const [priceSavings, setPriceSavings]           = useState(PRICE_ANNUAL_SAVINGS);

  useEffect(() => {
    fetchLivePrices().then(live => {
      if (!live) return; // Expo Go or offerings not configured — keep fallbacks
      setPriceMonthly(live.monthlyPrice);
      setPriceAnnual(live.annualPrice);
      setPriceAnnualMonthly(live.annualMonthlyPrice);
      setPriceSavings(live.savingsPercent);
    });
  }, []);

  const hero = HERO_COPY[reason] ?? HERO_COPY.general;
  const userId = session?.user?.id;

  const handlePurchase = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      const success = await purchasePro(plan, userId);
      if (success) {
        await fetchProfile();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onClose();
      }
    } catch {
      Alert.alert('Purchase failed', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    Haptics.selectionAsync();
    setRestoring(true);
    try {
      const restored = await restorePurchases(userId);
      if (restored) {
        await fetchProfile();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onClose();
      } else {
        Alert.alert('No purchases found', 'No active TPC Pro subscription was found on this Apple ID.');
      }
    } catch {
      Alert.alert('Restore failed', 'Something went wrong. Please try again.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* ── Close ── */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
          <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Logo + badge ── */}
          <View style={styles.logoRow}>
            <Image source={tpcSquare} style={styles.logo} resizeMode="contain" />
            <View style={styles.proBadge}>
              <Text style={styles.proBadgeText}>✦ TPC PRO</Text>
            </View>
          </View>

          {/* ── Hero ── */}
          <Text style={styles.headline}>{hero.headline}</Text>
          <Text style={styles.sub}>{hero.sub}</Text>

          {/* ── Feature list ── */}
          <View style={styles.featureList}>
            {FEATURES.map(f => (
              <View key={f.text} style={styles.featureRow}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon as keyof typeof Ionicons.glyphMap} size={18} color={colors.teal} />
                </View>
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          {/* ── Plan toggle ── */}
          <View style={styles.planToggle}>
            <TouchableOpacity
              style={[styles.planBtn, plan === 'monthly' && styles.planBtnActive]}
              onPress={() => { setPlan('monthly'); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.planBtnLabel, plan === 'monthly' && styles.planBtnLabelActive]}>
                Monthly
              </Text>
              <Text style={[styles.planBtnPrice, plan === 'monthly' && styles.planBtnPriceActive]}>
                {priceMonthly}/mo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.planBtn, plan === 'annual' && styles.planBtnActive]}
              onPress={() => { setPlan('annual'); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <View style={styles.saveBadge}>
                <Text style={styles.saveBadgeText}>SAVE {priceSavings}</Text>
              </View>
              <Text style={[styles.planBtnLabel, plan === 'annual' && styles.planBtnLabelActive]}>
                Annual
              </Text>
              <Text style={[styles.planBtnPrice, plan === 'annual' && styles.planBtnPriceActive]}>
                {priceAnnual}/yr
              </Text>
              <Text style={[styles.planBtnSub, plan === 'annual' && styles.planBtnSubActive]}>
                {priceAnnualMonthly}/month
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── CTA ── */}
          <TouchableOpacity
            onPress={handlePurchase}
            disabled={loading}
            activeOpacity={0.88}
            style={styles.ctaWrap}
          >
            <LinearGradient colors={gradients.teal} style={styles.cta}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaText}>
                  Start TPC Pro →
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <Text style={styles.legalText}>
            {plan === 'annual'
              ? `${priceAnnual}/year, auto-renews annually. Cancel anytime in App Store Settings.`
              : `${priceMonthly}/month, auto-renews monthly. Cancel anytime in App Store Settings.`}
          </Text>

          {/* ── Restore + dismiss ── */}
          <TouchableOpacity onPress={handleRestore} disabled={restoring} style={styles.restoreBtn}>
            <Text style={styles.restoreText}>
              {restoring ? 'Restoring…' : 'Restore purchase'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.laterBtn}>
            <Text style={styles.laterText}>Maybe later</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#212E38',  // Deep slate — premium feel, distinct from app
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: spacing.base,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
  // Logo
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  logo: {
    width: 52,
    height: 52,
  },
  proBadge: {
    backgroundColor: colors.gold,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  proBadgeText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: '#1A1A1A',
    letterSpacing: 1,
  },
  // Hero
  headline: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  sub: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xxl,
  },
  // Features
  featureList: {
    width: '100%',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(45,138,126,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: 'rgba(255,255,255,0.85)',
    flex: 1,
  },
  // Plan toggle
  planToggle: {
    flexDirection: 'row',
    width: '100%',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  planBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 2,
    minHeight: 80,
    justifyContent: 'center',
  },
  planBtnActive: {
    borderColor: colors.teal,
    backgroundColor: 'rgba(45,138,126,0.12)',
  },
  planBtnLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: 'rgba(255,255,255,0.5)',
  },
  planBtnLabelActive: {
    color: '#FFFFFF',
  },
  planBtnPrice: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: 'rgba(255,255,255,0.5)',
  },
  planBtnPriceActive: {
    color: '#FFFFFF',
  },
  planBtnSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.35)',
  },
  planBtnSubActive: {
    color: 'rgba(255,255,255,0.55)',
  },
  saveBadge: {
    backgroundColor: colors.gold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    marginBottom: 4,
  },
  saveBadgeText: {
    fontSize: 9,
    fontFamily: typography.bodySemiBold,
    color: '#1A1A1A',
    letterSpacing: 0.5,
  },
  // CTA
  ctaWrap: {
    width: '100%',
    marginBottom: spacing.sm,
  },
  cta: {
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  legalText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  restoreBtn: {
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  restoreText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: 'rgba(255,255,255,0.4)',
  },
  laterBtn: {
    paddingVertical: spacing.sm,
  },
  laterText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.3)',
  },
});
