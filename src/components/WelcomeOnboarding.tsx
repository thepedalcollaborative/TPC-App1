/**
 * WelcomeOnboarding
 *
 * 4-screen + CTA welcome flow shown on first install, before the auth screen.
 * Approach A: Problem/Solution storytelling.
 *
 * Screens:
 *   1. The Hook        — "How many pedals have you owned?"
 *   2. Your Vault      — collection grid + real market value
 *   3. Your AI Expert  — Custom Shop personalized pick
 *   4. Ask Anything    — Advisor chat at 2am
 *   5. CTA             — Sign up / already have an account
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  FlatList,
  useWindowDimensions,
  ViewToken,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';

const tpcLogo = require('../../assets/splash-icon.png');

// ─── Types ────────────────────────────────────────────────────────────────────

type WelcomeOnboardingProps = {
  onGetStarted: () => void;
  onSignIn: () => void;
};

type SlideData = {
  id: string;
  label: string;
  headline: string;
  sub: string;
  visual: React.ReactNode;
};

// ─── Mock visuals ─────────────────────────────────────────────────────────────

function VaultVisual() {
  const pedals = [
    { name: 'Klon Centaur', cat: 'DRIVE',   color: '#C45208' },
    { name: 'Big Muff Pi',  cat: 'DRIVE',   color: '#C45208' },
    { name: 'DD-8',         cat: 'DELAY',   color: '#2563EB' },
    { name: 'Holy Grail',   cat: 'REVERB',  color: '#8B5CF6' },
    { name: 'CE-2W',        cat: 'MOD',     color: '#EC4899' },
    { name: 'Eventide H9',  cat: 'MULTI',   color: '#F97316' },
  ];
  return (
    <View style={vv.root}>
      {/* Est. Value pill */}
      <View style={vv.valuePill}>
        <Text style={vv.valuePillLabel}>EST. COLLECTION VALUE</Text>
        <Text style={vv.valuePillAmount}>$4,240</Text>
        <View style={vv.valuePillDelta}>
          <Ionicons name="trending-up" size={13} color="#1A8C40" />
          <Text style={vv.valuePillDeltaText}>+$320 vs. paid</Text>
        </View>
      </View>
      {/* Mini pedal grid */}
      <View style={vv.grid}>
        {pedals.map(p => (
          <View key={p.name} style={vv.card}>
            <View style={[vv.catBadge, { backgroundColor: p.color + '22' }]}>
              <Text style={[vv.catText, { color: p.color }]}>{p.cat}</Text>
            </View>
            <Text style={vv.pedalName} numberOfLines={1}>{p.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const vv = StyleSheet.create({
  root: { width: '100%', gap: spacing.md },
  valuePill: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  valuePillLabel: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  valuePillAmount: {
    fontSize: 32,
    fontFamily: typography.display,
    color: colors.textPrimary,
    marginTop: 2,
  },
  valuePillDelta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  valuePillDeltaText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: '#1A8C40',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  card: {
    width: '31%',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    gap: 4,
  },
  catBadge: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  catText: {
    fontSize: 9,
    fontFamily: typography.bodySemiBold,
    letterSpacing: 0.5,
  },
  pedalName: {
    fontSize: 11,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
  },
});

function ExpertVisual() {
  return (
    <View style={ev.root}>
      <LinearGradient colors={['#3D5261', '#2A3E4E']} style={ev.card}>
        <View style={ev.topRow}>
          <View style={ev.badge}>
            <Text style={ev.badgeText}>✦ CUSTOM SHOP PICK</Text>
          </View>
          <Ionicons name="sparkles" size={16} color="rgba(255,255,255,0.5)" />
        </View>
        <Text style={ev.brand}>Strymon</Text>
        <Text style={ev.model}>Timeline</Text>
        <Text style={ev.reason}>
          "Your rig is ready for something huge in the delay slot. The Timeline matches your board philosophy and budget to the dollar."
        </Text>
        <View style={ev.footer}>
          <View style={ev.priceBadge}>
            <Text style={ev.priceText}>$350 used</Text>
          </View>
          <Text style={ev.avgText}>Avg. on Reverb</Text>
        </View>
      </LinearGradient>
      <View style={ev.tagRow}>
        <View style={ev.tag}><Text style={ev.tagText}>Your rig</Text></View>
        <View style={ev.tag}><Text style={ev.tagText}>Your budget</Text></View>
        <View style={ev.tag}><Text style={ev.tagText}>Your tone</Text></View>
      </View>
    </View>
  );
}

const ev = StyleSheet.create({
  root: { width: '100%', gap: spacing.md },
  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeText: {
    fontSize: 9,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.8,
  },
  brand: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: 'rgba(255,255,255,0.6)',
    marginTop: spacing.xs,
  },
  model: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: '#FFFFFF',
    marginTop: -4,
  },
  reason: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.75)',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  priceBadge: {
    backgroundColor: colors.teal,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  priceText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  avgText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.5)',
  },
  tagRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: colors.teal + '18',
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.teal + '40',
  },
  tagText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
});

function AdvisorVisual() {
  const messages = [
    { from: 'user', text: 'Should my compressor go before or after my overdrive?' },
    {
      from: 'ai',
      text: "Before, almost always. Before drive = tighter, more even signal going in. After drive = squashes the character you just created. Rule of thumb: compress what you want to control, not what you've already colored.",
    },
    { from: 'user', text: 'What about with fuzz?' },
    {
      from: 'ai',
      text: 'Fuzz is the exception — it\'s super picky about input impedance. Compressor after fuzz, or skip it entirely. Fuzz loves to breathe.',
    },
  ];
  return (
    <View style={av.root}>
      {messages.map((m, i) => (
        <View key={i} style={[av.bubble, m.from === 'user' ? av.userBubble : av.aiBubble]}>
          {m.from === 'ai' && (
            <View style={av.aiLabel}>
              <Ionicons name="sparkles" size={10} color={colors.teal} />
              <Text style={av.aiLabelText}>TPC Advisor</Text>
            </View>
          )}
          <Text style={[av.text, m.from === 'user' ? av.userText : av.aiText]}>
            {m.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const av = StyleSheet.create({
  root: { width: '100%', gap: spacing.sm },
  bubble: {
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    maxWidth: '90%',
    gap: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.slate,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  aiLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  aiLabelText: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    letterSpacing: 0.5,
  },
  text: {
    fontSize: typography.sizes.sm,
    lineHeight: 20,
  },
  userText: {
    fontFamily: typography.bodyMedium,
    color: '#fff',
  },
  aiText: {
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
});

// ─── Slides definition ────────────────────────────────────────────────────────

function buildSlides(): SlideData[] {
  return [
    {
      id: 'hook',
      label: 'WELCOME TO TPC',
      headline: 'Got GAS?',
      sub: "Gear Acquisition Syndrome is real. We built the app for it — track every pedal, know its value, and feed the itch responsibly.",
      visual: (
        <View style={hookVisual.root}>
          <View style={hookVisual.row}>
            {([
              { icon: 'briefcase-outline',   label: 'Vault',    bg: colors.teal + '18',    color: colors.teal },
              { icon: 'flash-outline',        label: 'Drive',    bg: '#C45208' + '18',      color: '#C45208' },
              { icon: 'sparkles-outline',     label: 'AI Pick',  bg: colors.teal + '18',    color: colors.teal },
              { icon: 'headset-outline',      label: 'Delay',    bg: '#2563EB' + '18',      color: '#2563EB' },
              { icon: 'water-outline',        label: 'Reverb',   bg: '#8B5CF6' + '18',      color: '#8B5CF6' },
              { icon: 'grid-outline',         label: 'Boards',   bg: '#F97316' + '18',      color: '#F97316' },
              { icon: 'pulse-outline',        label: 'Mod',      bg: '#EC4899' + '18',      color: '#EC4899' },
              { icon: 'chatbubble-outline',   label: 'Advisor',  bg: colors.success + '18', color: colors.success },
            ] as { icon: keyof typeof Ionicons.glyphMap; label: string; bg: string; color: string }[]).map((t) => (
              <View key={t.label} style={[hookVisual.tile, { backgroundColor: t.bg }]}>
                <Ionicons name={t.icon} size={22} color={t.color} />
                <Text style={[hookVisual.tileLabel, { color: t.color }]}>{t.label}</Text>
              </View>
            ))}
          </View>
          <LinearGradient
            colors={[colors.teal, colors.tealDark]}
            style={hookVisual.countCard}
          >
            <Ionicons name="globe-outline" size={28} color="rgba(255,255,255,0.7)" />
            <Text style={hookVisual.countLabel}>PEDALS TRACKED GLOBALLY</Text>
            <Text style={hookVisual.countSub}>Join the community</Text>
          </LinearGradient>
        </View>
      ),
    },
    {
      id: 'vault',
      label: 'YOUR VAULT',
      headline: "Every pedal you've ever owned \u2014 and what it's worth right now.",
      sub: 'Log your collection, see live market values from Reverb, and track if your gear is appreciating.',
      visual: <VaultVisual />,
    },
    {
      id: 'expert',
      label: 'YOUR AI EXPERT',
      headline: 'Stop guessing what to buy next.',
      sub: 'Tell us your rig, your tone, your budget. We hand you one perfect pick — not a list of options.',
      visual: <ExpertVisual />,
    },
    {
      id: 'advisor',
      label: 'ASK ANYTHING',
      headline: 'Questions at 2am.\nAnswered.',
      sub: 'Signal chain, tone chasing, gear compatibility — your AI advisor has deep gear knowledge and knows your board.',
      visual: <AdvisorVisual />,
    },
  ];
}

const hookVisual = StyleSheet.create({
  root: { width: '100%', gap: spacing.lg },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
  },
  tile: {
    width: 72,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tileLabel: {
    fontSize: 9,
    fontFamily: typography.bodySemiBold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  countCard: {
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: 4,
  },
  countLabel: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1.2,
  },
  count: {
    fontSize: 42,
    fontFamily: typography.display,
    color: '#fff',
  },
  countSub: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.6)',
  },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export function WelcomeOnboarding({ onGetStarted, onSignIn }: WelcomeOnboardingProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const flatRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const slides = buildSlides();
  const total = slides.length;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setActiveIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const goNext = () => {
    Haptics.selectionAsync();
    if (activeIndex < total - 1) {
      flatRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      onGetStarted();
    }
  };

  const renderSlide = ({ item }: { item: SlideData }) => (
    <View style={[slideStyles.slide, { width }]}>
      {/* Visual area */}
      <View style={slideStyles.visualArea}>
        {item.visual}
      </View>

      {/* Text block */}
      <View style={slideStyles.textBlock}>
        <Text style={slideStyles.label}>{item.label}</Text>
        <Text style={slideStyles.headline}>{item.headline}</Text>
        <Text style={slideStyles.sub}>{item.sub}</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Top bar: logo + skip */}
      <View style={styles.topBar}>
        <Image source={tpcLogo} style={styles.logo} resizeMode="contain" />
        <TouchableOpacity onPress={onSignIn} style={styles.skipBtn} activeOpacity={0.7}>
          <Text style={styles.skipText}>Sign In</Text>
        </TouchableOpacity>
      </View>

      {/* Slides */}
      <FlatList
        ref={flatRef}
        data={slides}
        keyExtractor={item => item.id}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        bounces={false}
        style={styles.list}
      />

      {/* Bottom controls */}
      <View style={styles.bottomArea}>
        {/* Dot indicators */}
        <View style={styles.dots}>
          {slides.map((_, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => {
                Haptics.selectionAsync();
                flatRef.current?.scrollToIndex({ index: i, animated: true });
              }}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.dot,
                  i === activeIndex ? styles.dotActive : styles.dotInactive,
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>

        {/* Primary CTA */}
        <TouchableOpacity onPress={goNext} activeOpacity={0.88} style={styles.ctaWrap}>
          <LinearGradient colors={gradients.teal} style={styles.cta}>
            <Text style={styles.ctaText}>
              {activeIndex === total - 1 ? 'Get Started — It\'s Free' : 'Next'}
            </Text>
            <Ionicons
              name={activeIndex === total - 1 ? 'arrow-forward' : 'chevron-forward'}
              size={18}
              color="#fff"
            />
          </LinearGradient>
        </TouchableOpacity>

        {/* Already have account */}
        <TouchableOpacity onPress={onSignIn} style={styles.signInRow} activeOpacity={0.7}>
          <Text style={styles.signInText}>Already have an account? </Text>
          <Text style={styles.signInLink}>Sign In</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  logo: {
    height: 30,
    width: 120,
  },
  skipBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  skipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  list: {
    flex: 1,
  },
  bottomArea: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  dot: {
    borderRadius: radius.full,
  },
  dotActive: {
    width: 24,
    height: 8,
    backgroundColor: colors.teal,
  },
  dotInactive: {
    width: 8,
    height: 8,
    backgroundColor: colors.border,
  },
  ctaWrap: {
    width: '100%',
  },
  cta: {
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ctaText: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: '#fff',
  },
  signInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  signInText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  signInLink: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
});

const slideStyles = StyleSheet.create({
  slide: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.xl,
    paddingTop: spacing.sm,
  },
  visualArea: {
    flex: 1,
    justifyContent: 'center',
  },
  textBlock: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  label: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    letterSpacing: 1.5,
  },
  headline: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
    lineHeight: 32,
  },
  sub: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
