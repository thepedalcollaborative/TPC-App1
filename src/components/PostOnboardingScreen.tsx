/**
 * PostOnboardingScreen
 *
 * Shown immediately after a user completes their tone profile for the first time.
 * This is the highest-intent moment in the app — they just invested 5 minutes
 * telling us everything about their rig. Show them the payoff.
 *
 * Usage (in App.tsx after PlayerOnboarding onComplete fires):
 *   setShowPostOnboarding(true);
 *   // After user taps a CTA, setShowPostOnboarding(false) + navigate
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';

const tpcSquare = require('../../assets/tpc-square.png');

const CHECKLIST = [
  'Your guitar + amp setup',
  'Your sonic heroes',
  'Your genres + board philosophy',
  'Your budget + complexity preference',
  'Your tone identity',
];

type PostOnboardingScreenProps = {
  onGetMyPick: () => void;
  onExplore: () => void;
};

export function PostOnboardingScreen({ onGetMyPick, onExplore }: PostOnboardingScreenProps) {
  const insets      = useSafeAreaInsets();
  const logoScale   = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const contentY    = useRef(new Animated.Value(24)).current;
  const contentOp   = useRef(new Animated.Value(0)).current;
  const ctaOp       = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    Animated.sequence([
      // Logo pops in
      Animated.parallel([
        Animated.spring(logoScale,   { toValue: 1, tension: 55, friction: 7, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
      Animated.delay(180),
      // Content slides up
      Animated.parallel([
        Animated.spring(contentY,  { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
        Animated.timing(contentOp, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
      Animated.delay(200),
      // CTA fades in last
      Animated.timing(ctaOp, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      {/* Teal gradient top glow */}
      <LinearGradient
        colors={[colors.teal + '30', 'transparent']}
        style={styles.topGlow}
        pointerEvents="none"
      />

      {/* ── Logo ── */}
      <Animated.View style={{ transform: [{ scale: logoScale }], opacity: logoOpacity }}>
        <Image source={tpcSquare} style={styles.logo} resizeMode="contain" />
      </Animated.View>

      {/* ── Hero text ── */}
      <Animated.View
        style={[
          styles.heroSection,
          { transform: [{ translateY: contentY }], opacity: contentOp },
        ]}
      >
        <Text style={styles.headline}>Your sound profile{'\n'}is complete.</Text>
        <Text style={styles.sub}>
          Your AI expert now knows everything it needs to make the call.
        </Text>
      </Animated.View>

      {/* ── Checklist ── */}
      <Animated.View
        style={[
          styles.checklist,
          { transform: [{ translateY: contentY }], opacity: contentOp },
        ]}
      >
        {CHECKLIST.map(item => (
          <View key={item} style={styles.checkRow}>
            <View style={styles.checkIcon}>
              <Ionicons name="checkmark" size={14} color="#fff" />
            </View>
            <Text style={styles.checkText}>{item}</Text>
          </View>
        ))}
      </Animated.View>

      {/* ── CTAs ── */}
      <Animated.View style={[styles.ctaSection, { opacity: ctaOp }]}>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onGetMyPick();
          }}
          activeOpacity={0.88}
          style={styles.primaryCTAWrap}
        >
          <LinearGradient colors={gradients.teal} style={styles.primaryCTA}>
            <Text style={styles.primaryCTAText}>Get My First Expert Pick →</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity onPress={onExplore} style={styles.secondaryCTA} activeOpacity={0.7}>
          <Text style={styles.secondaryCTAText}>I'll explore the app first</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  logo: {
    width: 80,
    height: 80,
    marginTop: spacing.lg,
  },
  heroSection: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  headline: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 38,
  },
  sub: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  checklist: {
    width: '100%',
    gap: spacing.md,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  checkIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  ctaSection: {
    width: '100%',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  primaryCTAWrap: {
    width: '100%',
  },
  primaryCTA: {
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryCTAText: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: '#fff',
  },
  secondaryCTA: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  secondaryCTAText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
});
