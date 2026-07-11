import React, { useState, useRef, useEffect, useCallback } from 'react';
import { USE_NATIVE_DRIVER } from '../lib/iosVersion';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import { supabase, UserProfile, UserPedal } from '../lib/supabase';
import { CategoryBadge, SocialShareSheet } from './index';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_HEIGHT = Math.min(SCREEN_HEIGHT * 0.56, 440);
const SWIPE_THRESHOLD = 100;
const TUTORIAL_KEY = 'tpc_gas_or_pass_tutorial_shown';
const ALL_CATEGORIES = ['drive', 'delay', 'reverb', 'modulation', 'ambient', 'looper', 'pitch', 'compressor', 'boost'];

type GasPedal = {
  id: string;
  brand: string;
  model: string;
  category: string;
  avg_price: number | null;
  image_url: string | null;
  image_source: string | null;
  gas_count: number;
};

type Props = {
  onBack: () => void;
  ownedPedals: UserPedal[];
  wishlistPedals: UserPedal[];
  retiredPedals: UserPedal[];
  addToWishlist: (brand: string, model: string) => Promise<string>;
  profile: UserProfile | null;
};

// ── Robust exclusion ─────────────────────────────────────────────────────────
// Normalize brand+model together — strips noise words Reverb sellers add to titles
function normStr(brand: string, model: string): string {
  return `${brand} ${model}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    // Brand suffixes
    .replace(/\b(audio|effects|pedals|company|guitar|toneworks|electronics|music|co)\b/g, '')
    // Condition words
    .replace(/\b(used|mint|new|excellent|good|fair|poor|pristine|vintage|rare|demo|blemished|refurbished)\b/g, '')
    // Effect-category / listing words
    .replace(/\b(overdrive|distortion|fuzz|delay|reverb|modulation|chorus|vibrato|phaser|flanger|tremolo|boost|compressor|looper|pitch|shifter|wah|filter|equalizer|preamp|pedal|effect|effects|stompbox|unit|processor|floor|instrument)\b/g, '')
    // Version notation — normalize MkII → v2 etc.
    .replace(/\bmark\s*iv\b|\bmk\s*iv\b/g, 'v4')
    .replace(/\bmark\s*iii\b|\bmk\s*iii\b/g, 'v3')
    .replace(/\bmark\s*ii\b|\bmk\s*ii\b/g, 'v2')
    .replace(/\bmark\s*i\b|\bmk\s*i\b/g, 'v1')
    // Color / cosmetic words (same pedal, different colorway)
    .replace(/\b(black|white|grey|gray|silver|gold|blue|red|green|yellow|orange|purple|pink|brown|cream|mint|teal|matte|gloss|limited|edition|anniversary)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildExclusionData(pedals: UserPedal[]): { ids: Set<string>; normalized: string[] } {
  const ids = new Set<string>();
  const normalized: string[] = [];
  for (const up of pedals) {
    if (up.pedal_id) ids.add(up.pedal_id);
    if (up.pedal?.brand && up.pedal?.model) {
      const n = normStr(up.pedal.brand, up.pedal.model);
      if (n.length > 2) normalized.push(n);
    }
  }
  return { ids, normalized };
}

function isPedalOwned(
  candidateId: string,
  candidateBrand: string,
  candidateModel: string,
  ids: Set<string>,
  normalized: string[],
): boolean {
  if (ids.has(candidateId)) return true;
  const candidateNorm = normStr(candidateBrand, candidateModel);
  // Need at least 6 chars to substring-match reliably (avoids brand-only false positives)
  if (candidateNorm.length < 6) return false;
  for (const owned of normalized) {
    // One direction only: does the candidate's normalized string contain the owned key?
    // Reverse would cause "walrus" to match every Walrus pedal in the catalog.
    if (owned.length >= 6 && candidateNorm.includes(owned)) return true;
  }
  return false;
}

// ─── Card visual ──────────────────────────────────────────────────────────────
function formatGasCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function CardContent({ pedal, isRigGap }: { pedal: GasPedal; isRigGap: boolean }) {
  const catColor = (colors as Record<string, string>)[pedal.category] ?? colors.textMuted;
  const [imgError, setImgError] = useState(false);
  const showImage = pedal.image_url && !imgError;
  return (
    <View style={styles.cardInner}>
      {showImage ? (
        <Image
          source={{ uri: pedal.image_url! }}
          style={styles.cardImage}
          resizeMode="cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <LinearGradient
          colors={[catColor + 'DD', catColor + '88']}
          style={styles.cardImagePlaceholder}
        >
          <Text style={styles.cardEmoji}>🎛</Text>
        </LinearGradient>
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.82)']}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.cardOverlay}>
        <View style={styles.cardTopRow}>
          <View style={styles.cardTopLeft}>
            <CategoryBadge category={pedal.category} />
            {isRigGap && (
              <View style={styles.rigGapBadge}>
                <Ionicons name="radio-outline" size={10} color={colors.teal} />
                <Text style={styles.rigGapText}>fills your rig</Text>
              </View>
            )}
          </View>
          <View style={styles.cardTopRight}>
            {pedal.avg_price != null && (
              <View style={styles.pricePill}>
                <Text style={styles.priceText}>${pedal.avg_price}</Text>
              </View>
            )}
            {pedal.gas_count > 0 && (
              <View style={styles.gasCountPill}>
                <Text style={styles.gasCountText}>🔥 {formatGasCount(pedal.gas_count)} want this</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.cardBrand}>{pedal.brand}</Text>
          <Text style={styles.cardModel}>{pedal.model}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function GasOrPassMode({ onBack, ownedPedals, wishlistPedals, retiredPedals, addToWishlist, profile }: Props) {
  const [deck, setDeck] = useState<GasPedal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [gasCount, setGasCount] = useState(0);
  const [passCount, setPassCount] = useState(0);
  const [gasAdded, setGasAdded] = useState<GasPedal[]>([]);
  const [shareNudge, setShareNudge] = useState<GasPedal | null>(null);
  const shareNudgeOpacity = useRef(new Animated.Value(0)).current;
  const [nudgeSheetPedal, setNudgeSheetPedal] = useState<GasPedal | null>(null);
  const [nudgeShareOpen, setNudgeShareOpen] = useState(false);
  const [sessionShareOpen, setSessionShareOpen] = useState(false);

  const seenThisSession = useRef(new Set<string>());
  const [rigGapCategories, setRigGapCategories] = useState<string[]>([]);
  const isFetching = useRef(false);
  const deckRef = useRef<GasPedal[]>([]);
  const pan = useRef(new Animated.ValueXY()).current;
  const nextCardScale = useRef(new Animated.Value(0.94)).current;
  const tutorialAnim = useRef(new Animated.Value(0)).current;
  const swipeCardRef = useRef<(dir: 'gas' | 'pass') => void>(() => {});

  // ── Derived card animations ──────────────────────────────────────────────
  const rotate = pan.x.interpolate({
    inputRange: [-200, 0, 200],
    outputRange: ['-12deg', '0deg', '12deg'],
    extrapolate: 'clamp',
  });
  const gasOpacity = pan.x.interpolate({
    inputRange: [20, 100],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const passOpacity = pan.x.interpolate({
    inputRange: [-100, -20],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // ── Fetch a batch of pedals ──────────────────────────────────────────────
  const fetchPedals = useCallback(async () => {
    if (isFetching.current) return;
    isFetching.current = true;

    const allUserPedals = [...ownedPedals, ...wishlistPedals, ...retiredPedals];
    const { ids: ownedIds, normalized: ownedNorms } = buildExclusionData(allUserPedals);

    // Rig-gap detection — categories the user has no owned pedals in
    const ownedCategories = new Set(
      ownedPedals.map(p => p.pedal?.category).filter(Boolean),
    );
    const gaps = ALL_CATEGORIES.filter(c => !ownedCategories.has(c));
    setRigGapCategories(gaps);

    // Category ordering: rig gaps first, then profile preference, then random
    const expertProfile = profile?.pedal_expert_profile;
    let orderedCategories = [...ALL_CATEGORIES].sort(() => Math.random() - 0.5);

    if (expertProfile) {
      const genre = (expertProfile as Record<string, unknown>).genre as string | undefined;
      const preferred: string[] =
        genre === 'blues' ? ['drive', 'reverb', 'delay']
        : genre === 'rock' ? ['drive', 'delay', 'modulation']
        : genre === 'metal' ? ['drive', 'pitch']
        : genre === 'ambient' ? ['reverb', 'delay', 'ambient']
        : [];
      if (preferred.length) {
        orderedCategories = [
          ...preferred,
          ...orderedCategories.filter(c => !preferred.includes(c)),
        ];
      }
    }

    // Rig gaps bubble to the front
    if (gaps.length > 0) {
      orderedCategories = [
        ...gaps,
        ...orderedCategories.filter(c => !gaps.includes(c)),
      ];
    }

    const results: GasPedal[] = [];
    for (const cat of orderedCategories.slice(0, 5)) {
      const { data } = await supabase
        .from('pedals')
        .select('id, brand, model, category, avg_price, image_url, image_source, gas_count')
        .eq('category', cat)
        .not('image_url', 'is', null)
        // Prefer manufacturer/preferred_seller images — these sort before reverb_listing and null
        .order('image_source', { ascending: false, nullsFirst: false })
        .order('gas_count', { ascending: false })
        .limit(20);

      if (data) {
        const filtered = data.filter(p => {
          const sessionKey = `${p.brand.toLowerCase()}|${p.model.toLowerCase()}`;
          if (seenThisSession.current.has(sessionKey)) return false;
          return !isPedalOwned(p.id, p.brand, p.model, ownedIds, ownedNorms);
        });
        results.push(...filtered);
      }
    }

    // Dedup by normalized brand+model — catches duplicate catalog rows
    const seenInBatch = new Set<string>();
    const deduped = results.filter(p => {
      const key = normStr(p.brand, p.model);
      if (seenInBatch.has(key)) return false;
      seenInBatch.add(key);
      return true;
    });

    const shuffled = deduped.sort(() => Math.random() - 0.5);
    shuffled.forEach(p =>
      seenThisSession.current.add(`${p.brand.toLowerCase()}|${p.model.toLowerCase()}`),
    );
    setDeck(prev => {
      const updated = [...prev, ...shuffled];
      deckRef.current = updated;
      return updated;
    });
    setIsLoading(false);
    isFetching.current = false;
  }, [ownedPedals, wishlistPedals, retiredPedals, profile]);

  // Reactively purge any owned pedals that slipped into the deck
  useEffect(() => {
    const allUserPedals = [...ownedPedals, ...wishlistPedals, ...retiredPedals];
    if (allUserPedals.length === 0) return;
    const { ids: ownedIds, normalized: ownedNorms } = buildExclusionData(allUserPedals);
    setDeck(prev => {
      const filtered = prev.filter(p => !isPedalOwned(p.id, p.brand, p.model, ownedIds, ownedNorms));
      if (filtered.length === prev.length) return prev;
      deckRef.current = filtered;
      return filtered;
    });
  }, [ownedPedals, wishlistPedals, retiredPedals]);


  useEffect(() => {
    fetchPedals();
    AsyncStorage.getItem(TUTORIAL_KEY).then(val => {
      if (!val) setShowTutorial(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch when deck runs low
  useEffect(() => {
    if (!isLoading && deck.length > 0 && deck.length < 6) {
      fetchPedals();
    }
  }, [deck.length, isLoading, fetchPedals]);

  // ── Tutorial hand animation ──────────────────────────────────────────────
  useEffect(() => {
    if (!showTutorial) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tutorialAnim, { toValue: 1, duration: 600, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.delay(200),
        Animated.timing(tutorialAnim, { toValue: -1, duration: 600, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.delay(200),
        Animated.timing(tutorialAnim, { toValue: 0, duration: 300, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.delay(600),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [showTutorial, tutorialAnim]);

  const dismissTutorial = () => {
    setShowTutorial(false);
    AsyncStorage.setItem(TUTORIAL_KEY, '1');
  };

  // ── Swipe handler ────────────────────────────────────────────────────────
  const swipeCard = useCallback(
    (direction: 'gas' | 'pass') => {
      const toX = direction === 'gas' ? 600 : -600;
      Haptics.impactAsync(
        direction === 'gas'
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light,
      );

      Animated.timing(pan, {
        toValue: { x: toX, y: 0 },
        duration: 230,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start(() => {
        // Read top card from ref — safe to use outside a state updater
        const top = deckRef.current[0];
        if (top) {
          if (direction === 'gas') {
            setGasCount(c => c + 1);
            setGasAdded(a => [...a, top]);
            addToWishlist(top.brand, top.model);
            // Increment community gas_count in Supabase
            void supabase.rpc('increment_gas_count', { pedal_id: top.id });
            // Flash share nudge
            setShareNudge(top);
            shareNudgeOpacity.setValue(0);
            Animated.sequence([
              Animated.timing(shareNudgeOpacity, { toValue: 1, duration: 250, useNativeDriver: USE_NATIVE_DRIVER }),
              Animated.delay(2800),
              Animated.timing(shareNudgeOpacity, { toValue: 0, duration: 350, useNativeDriver: USE_NATIVE_DRIVER }),
            ]).start(() => setShareNudge(null));
          } else {
            setPassCount(c => c + 1);
          }
        }
        setDeck(prev => {
          const updated = prev.slice(1);
          deckRef.current = updated;
          return updated;
        });
        pan.setValue({ x: 0, y: 0 });
        nextCardScale.setValue(0.94);
      });
    },
    [pan, nextCardScale, addToWishlist],
  );

  // Keep ref fresh so panResponder (which captures by ref) always uses latest
  useEffect(() => {
    swipeCardRef.current = swipeCard;
  }, [swipeCard]);

  // ── PanResponder ─────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6,
      onPanResponderGrant: () => {
        Animated.spring(nextCardScale, {
          toValue: 1,
          useNativeDriver: USE_NATIVE_DRIVER,
          friction: 8,
        }).start();
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_, g) => {
        if (g.dx > SWIPE_THRESHOLD) {
          swipeCardRef.current('gas');
        } else if (g.dx < -SWIPE_THRESHOLD) {
          swipeCardRef.current('pass');
        } else {
          Animated.parallel([
            Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: USE_NATIVE_DRIVER, friction: 7 }),
            Animated.spring(nextCardScale, { toValue: 0.94, useNativeDriver: USE_NATIVE_DRIVER, friction: 8 }),
          ]).start();
        }
      },
    }),
  ).current;

  const handleExit = () => {
    if (gasCount > 0 || passCount > 0) {
      setShowSummary(true);
    } else {
      onBack();
    }
  };

  // ── Summary screen ───────────────────────────────────────────────────────
  if (showSummary) {
    return (
      <View style={styles.summaryContainer}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEmoji}>🔥</Text>
          <Text style={styles.summaryTitle}>Session Wrapped</Text>
          <Text style={styles.summaryStats}>
            {gasCount} GAS'd · {passCount} passed
          </Text>
          {gasAdded.length > 0 && (
            <View style={styles.summaryList}>
              <Text style={styles.summaryListLabel}>Added to your GAS List</Text>
              {gasAdded.map(p => (
                <View key={`${p.brand}|${p.model}`} style={styles.summaryItem}>
                  <Ionicons name="checkmark-circle" size={15} color={colors.teal} />
                  <Text style={styles.summaryItemText}>
                    {p.brand} {p.model}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {gasAdded.length > 0 && (
            <TouchableOpacity
              style={styles.summaryShareBtn}
              onPress={() => { Haptics.selectionAsync(); setSessionShareOpen(true); }}
              activeOpacity={0.8}
            >
              <Ionicons name="share-social-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.summaryShareBtnText}>Share this session</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.summaryDoneBtn} onPress={onBack} activeOpacity={0.85}>
            <LinearGradient
              colors={[colors.teal, colors.tealDark]}
              style={styles.summaryDoneBtnGrad}
            >
              <Text style={styles.summaryDoneBtnText}>Done</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading && deck.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.teal} />
        <Text style={styles.loadingText}>Loading pedals…</Text>
      </View>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (!isLoading && deck.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyEmoji}>🎸</Text>
        <Text style={styles.emptyTitle}>You've seen them all!</Text>
        <Text style={styles.emptySub}>{gasCount} added to your GAS List</Text>
        <TouchableOpacity style={styles.summaryDoneBtn} onPress={onBack} activeOpacity={0.85}>
          <LinearGradient
            colors={[colors.teal, colors.tealDark]}
            style={styles.summaryDoneBtnGrad}
          >
            <Text style={styles.summaryDoneBtnText}>Done</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  const topCard = deck[0];
  const nextCard = deck[1];

  return (
    <View style={styles.container}>
      {/* ── Mode header ── */}
      <View style={styles.modeHeader}>
        <TouchableOpacity onPress={handleExit} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.gasCounter}>
          <Ionicons name="flame" size={14} color={colors.rose} />
          <Text style={styles.gasCounterText}>{gasCount} GAS'd</Text>
        </View>
      </View>

      {/* ── Card stack ── */}
      <View style={styles.cardStack}>
        {/* Next card (behind) */}
        {nextCard && (
          <Animated.View
            style={[styles.card, styles.cardBack, { transform: [{ scale: nextCardScale }] }]}
          >
            <CardContent pedal={nextCard} isRigGap={rigGapCategories.includes(nextCard.category)} />
          </Animated.View>
        )}

        {/* Top card (active) */}
        {topCard && (
          <Animated.View
            style={[
              styles.card,
              {
                transform: [
                  { translateX: pan.x },
                  { translateY: pan.y },
                  { rotate },
                ],
              },
            ]}
            {...panResponder.panHandlers}
          >
            {/* GAS overlay */}
            <Animated.View
              style={[styles.swipeLabel, styles.gasLabel, { opacity: gasOpacity }]}
              pointerEvents="none"
            >
              <Text style={styles.gasLabelText}>GAS!</Text>
            </Animated.View>
            {/* Pass overlay */}
            <Animated.View
              style={[styles.swipeLabel, styles.passLabel, { opacity: passOpacity }]}
              pointerEvents="none"
            >
              <Text style={styles.passLabelText}>Pass</Text>
            </Animated.View>

            <CardContent pedal={topCard} isRigGap={rigGapCategories.includes(topCard.category)} />
          </Animated.View>
        )}
      </View>

      {/* ── Action buttons ── */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.passBtn}
          onPress={() => swipeCardRef.current('pass')}
          activeOpacity={0.8}
        >
          <Ionicons name="close" size={26} color={colors.textSecondary} />
          <Text style={styles.passBtnLabel}>Pass</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.gasBtn}
          onPress={() => swipeCardRef.current('gas')}
          activeOpacity={0.8}
        >
          <LinearGradient colors={[colors.rose, colors.roseDark]} style={styles.gasBtnGrad}>
            <Ionicons name="flame" size={26} color="#fff" />
            <Text style={styles.gasBtnLabel}>GAS it</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ── Hint ── */}
      <Text style={styles.hint}>Swipe right to GAS · Swipe left to Pass</Text>

      {/* ── Tutorial overlay ── */}
      {showTutorial && (
        <TouchableOpacity
          style={styles.tutorialOverlay}
          activeOpacity={1}
          onPress={dismissTutorial}
        >
          <View style={styles.tutorialCard}>
            <Text style={styles.tutorialTitle}>GAS or Pass?</Text>
            <Text style={styles.tutorialSub}>
              Swipe through pedals you don't own yet.
            </Text>

            <View style={styles.tutorialRow}>
              <View style={styles.tutorialAction}>
                <View style={[styles.tutorialIcon, { backgroundColor: '#94A3B8' }]}>
                  <Ionicons name="close" size={24} color="#fff" />
                </View>
                <Text style={styles.tutorialActionLabel}>Swipe left{'\n'}to Pass</Text>
              </View>

              <Animated.View
                style={{
                  transform: [
                    { translateX: Animated.multiply(tutorialAnim, 36) },
                  ],
                }}
              >
                <Ionicons name="swap-horizontal" size={34} color="rgba(255,255,255,0.7)" />
              </Animated.View>

              <View style={styles.tutorialAction}>
                <View style={[styles.tutorialIcon, { backgroundColor: colors.rose }]}>
                  <Ionicons name="flame" size={24} color="#fff" />
                </View>
                <Text style={styles.tutorialActionLabel}>Swipe right{'\n'}to GAS it</Text>
              </View>
            </View>

            <Text style={styles.tutorialTap}>Tap anywhere to start</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* ── Share nudge — flashes after each GAS swipe ── */}
      {shareNudge && (
        <Animated.View style={[styles.shareNudgeBanner, { opacity: shareNudgeOpacity }]}>
          <Text style={styles.shareNudgeText} numberOfLines={1}>
            {shareNudge.brand} {shareNudge.model} added to GAS List
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (shareNudge) {
                setNudgeSheetPedal(shareNudge);
                setNudgeShareOpen(true);
              }
            }}
            style={styles.shareNudgeBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="share-outline" size={13} color={colors.teal} />
            <Text style={styles.shareNudgeBtnText}>Share</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Nudge share sheet — opens for the pedal just GAS'd */}
      {nudgeSheetPedal && (
        <SocialShareSheet
          visible={nudgeShareOpen}
          onClose={() => setNudgeShareOpen(false)}
          text={[
            `GASing hard for the ${nudgeSheetPedal.brand} ${nudgeSheetPedal.model} 🔥`,
            '',
            `Found it on TPC — https://thepedalcollaborative.com`,
            '',
            '#guitarpedals #GAS #pedalboard #tonehunter',
          ].join('\n')}
          xText={`GASing hard for the ${nudgeSheetPedal.brand} ${nudgeSheetPedal.model} 🔥 #guitarpedals #GAS`}
        />
      )}

      {/* Session summary share sheet */}
      {(() => {
        const topPedal = gasAdded[0];
        const sessionText = [
          topPedal
            ? `Just GAS'd ${gasCount} pedal${gasCount !== 1 ? 's' : ''} on TPC — starting with the ${topPedal.brand} ${topPedal.model} 🔥`
            : `Swiped through pedals on TPC and GAS'd ${gasCount} of them 🔥`,
          '',
          `Find yours → https://thepedalcollaborative.com`,
          '',
          '#guitarpedals #GAS #pedalboard #tonehunter',
        ].join('\n');
        return (
          <SocialShareSheet
            visible={sessionShareOpen}
            onClose={() => setSessionShareOpen(false)}
            text={sessionText}
            xText={topPedal
              ? `Just GAS'd ${gasCount} pedal${gasCount !== 1 ? 's' : ''} on TPC 🔥 #guitarpedals #GAS`
              : `GAS'd ${gasCount} pedals on TPC 🔥 #guitarpedals #GAS`}
          />
        );
      })()}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  emptySub: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // ── Mode header
  modeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
  },
  backBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  gasCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  gasCounterText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textSecondary,
  },
  // ── Card stack
  cardStack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    height: CARD_HEIGHT,
    borderRadius: radius.xl,
    overflow: 'hidden',
    position: 'absolute',
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  cardBack: {
    position: 'absolute',
  },
  cardInner: {
    flex: 1,
  },
  cardImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  cardImagePlaceholder: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: {
    fontSize: 64,
  },
  cardOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: spacing.xl,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTopLeft: {
    gap: 6,
    alignItems: 'flex-start',
  },
  cardTopRight: {
    gap: 6,
    alignItems: 'flex-end',
  },
  pricePill: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  priceText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  gasCountPill: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  gasCountText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  rigGapBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.teal + '33',
    borderWidth: 1,
    borderColor: colors.teal + '88',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  rigGapText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    letterSpacing: 0.3,
  },
  cardBottom: {
    gap: 2,
  },
  cardBrand: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.78)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardModel: {
    fontSize: 28,
    fontFamily: typography.display,
    color: '#fff',
    lineHeight: 34,
  },
  // ── Swipe labels
  swipeLabel: {
    position: 'absolute',
    zIndex: 10,
    top: spacing.xl,
    borderWidth: 3,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  gasLabel: {
    right: spacing.xl,
    borderColor: colors.rose,
    transform: [{ rotate: '8deg' }],
  },
  gasLabelText: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.rose,
    letterSpacing: 1,
  },
  passLabel: {
    left: spacing.xl,
    borderColor: '#94A3B8',
    transform: [{ rotate: '-8deg' }],
  },
  passLabelText: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: '#94A3B8',
    letterSpacing: 1,
  },
  // ── Action buttons
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.lg,
  },
  passBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  passBtnLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  gasBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    overflow: 'hidden',
    shadowColor: colors.rose,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  gasBtnGrad: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  gasBtnLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  hint: {
    textAlign: 'center',
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    paddingBottom: spacing.sm,
  },
  // ── Summary
  summaryContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  summaryCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  summaryEmoji: {
    fontSize: 44,
  },
  summaryTitle: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  summaryStats: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
  },
  summaryList: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  summaryListLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryItemText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  summaryDoneBtn: {
    width: '100%',
    borderRadius: radius.full,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  summaryDoneBtnGrad: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  summaryDoneBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  // ── Tutorial overlay
  tutorialOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,30,40,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  tutorialCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  tutorialTitle: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: '#fff',
  },
  tutorialSub: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    lineHeight: 22,
  },
  tutorialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: spacing.lg,
  },
  tutorialAction: {
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  tutorialIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tutorialActionLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    lineHeight: 19,
  },
  tutorialTap: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.3,
  },
  // ── Share nudge banner
  shareNudgeBanner: {
    position: 'absolute',
    bottom: 140,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 6,
  },
  shareNudgeText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  shareNudgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.teal + '1A',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  shareNudgeBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  // ── Summary share button
  summaryShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  summaryShareBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
  },
});
