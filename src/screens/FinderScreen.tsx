import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { USE_NATIVE_DRIVER } from '../lib/iosVersion';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Alert,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients, categoryColors } from '../theme';
import { CategoryBadge, ExpertMode, GasOrPassMode } from '../components';
import { useStore } from '../hooks/useStore';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { supabase, invokeEdgeFunction } from '../lib/supabase';
import { shareRecommendation } from '../lib/share';
import { ownedExclusionKeys, isExcluded } from '../lib/pedalNormalization';
import { HiddenShareCard } from '../components/ShareCard';
import { useShareCard } from '../lib/useShareCard';

type FinderPedal = {
  brand: string;
  model: string;
  category: string;
  avg_price: number | null;
  photo_url: string | null;
  in_catalog?: boolean;
  pedal_id?: string | null;
  description?: string | null;
};

type SocialCounts = {
  vault_count: number;
  gas_count: number;
};

type SearchPedalsResponse = {
  results?: FinderPedal[];
  pedals?: Array<{ image_url?: string | null }>;
};

type Screen = 'idle' | 'quiz' | 'loading' | 'result';
type Mode = 'quiz' | 'expert' | 'gasOrPass';

// ─── Quiz Data ────────────────────────────────────────────────────────────────

// Shared Q2 + Q3 — used in both quiz variants
const QUIZ_STEPS_SHARED = [
  {
    question: "What's your budget?",
    emoji: '💰',
    options: [
      { label: 'Under $100', value: '100' },
      { label: '$100 – $200', value: '200' },
      { label: '$200 – $400', value: '400' },
      { label: 'No limit', value: '9999' },
    ],
  },
  {
    question: 'Which effect are you after?',
    emoji: '🎛',
    options: [
      { label: 'Overdrive / Fuzz', value: 'drive' },
      { label: 'Delay / Echo', value: 'delay' },
      { label: 'Reverb / Space', value: 'reverb' },
      { label: 'Modulation', value: 'modulation' },
      { label: 'Something Weird', value: 'ambient' },
    ],
  },
];

// Default Q1 — ask genre when no tone profile exists
const Q1_DEFAULT = {
  question: "What's your main playing style?",
  emoji: '🎸',
  options: [
    { label: 'Blues / Country', value: 'blues' },
    { label: 'Rock / Alt', value: 'rock' },
    { label: 'Metal / High Gain', value: 'metal' },
    { label: 'Ambient / Shoegaze', value: 'ambient' },
    { label: 'Everything', value: 'all' },
  ],
};

// Profile-aware Q1 — ask feel/vibe when we already know their genre
const Q1_PROFILE = {
  question: "What feel are you chasing right now?",
  emoji: '🎯',
  options: [
    { label: 'Warm and organic', value: 'blues' },
    { label: 'Raw and edgy', value: 'rock' },
    { label: 'Tight and heavy', value: 'metal' },
    { label: 'Lush and immersive', value: 'ambient' },
    { label: 'Show me something unexpected', value: 'all' },
  ],
};

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scorePedal(
  pedal: FinderPedal,
  genre: string,
  budgetMax: number,
  category: string
): number {
  let score = 0;

  // Category match is the most important
  if (pedal.category === category) score += 5;

  // Budget
  if (pedal.avg_price != null) {
    if (pedal.avg_price <= budgetMax) score += 3;
    else if (pedal.avg_price <= budgetMax * 1.25) score += 1;
  }

  // Genre bonuses
  if (genre === 'blues') {
    if (['drive', 'reverb', 'utility'].includes(pedal.category)) score += 2;
    if (pedal.avg_price != null && pedal.avg_price <= 200) score += 1;
  } else if (genre === 'rock') {
    if (['drive', 'delay'].includes(pedal.category)) score += 1;
  } else if (genre === 'metal') {
    if (pedal.category === 'drive') score += 3;
    if (pedal.category === 'utility') score += 1;
  } else if (genre === 'ambient') {
    if (['ambient', 'reverb', 'delay'].includes(pedal.category)) score += 3;
  }

  return score;
}

function findBestMatch(
  genre: string,
  budgetMax: number,
  category: string,
  excluded: Set<string>,
  candidates: FinderPedal[]
): FinderPedal {
  const eligible = candidates.filter(p =>
    !(p.pedal_id && excluded.has(`id:${p.pedal_id}`)) && !isExcluded(p.brand, p.model, excluded));
  const pool = eligible.length > 0 ? eligible : candidates;
  const scored = pool.map(p => ({
    pedal: p,
    score: scorePedal(p, genre, budgetMax, category),
  })).sort((a, b) => b.score - a.score);

  // Pick from top 3 for variety
  const topN = scored.slice(0, 3);
  return topN[Math.floor(Math.random() * topN.length)].pedal;
}

// ─── Module-level constants (static — never re-created on render) ─────────────
const SURPRISE_QUERIES = [
  'overdrive pedal',
  'distortion pedal',
  'fuzz pedal',
  'delay pedal',
  'reverb pedal',
  'chorus pedal',
  'phaser pedal',
  'tremolo pedal',
  'looper pedal',
  'compressor pedal',
  'multi fx pedal',
  'ambient pedal',
];

const CATEGORY_QUERY: Record<string, string> = {
  drive: 'overdrive distortion fuzz pedal',
  boost: 'boost pedal',
  compressor: 'compressor pedal',
  eq: 'eq equalizer pedal',
  delay: 'delay echo pedal',
  reverb: 'reverb pedal',
  modulation: 'chorus phaser flanger tremolo pedal',
  ambient: 'ambient reverb delay pedal',
  looper: 'looper pedal',
  pitch: 'octave pitch shifter pedal',
  utility: 'compressor eq noise gate pedal',
};

const GENRE_QUERY: Record<string, string> = {
  blues: 'blues',
  rock: 'rock',
  metal: 'metal high gain',
  ambient: 'ambient',
  praise_worship: 'clean reverb worship',
  all: 'guitar',
};

const NO_RESULTS_MSG = 'Reverb did not return any pedals. Try again in a moment.';

// ─── Component ────────────────────────────────────────────────────────────────
export default function FinderScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<{ Finder: { startMode?: 'expert' | 'gasOrPass' | 'surpriseMe' } }, 'Finder'>>();
  const startMode = route.params?.startMode;
  // When navigated directly from AIHub with a startMode, back should return to the hub.
  const fromHub = Boolean(startMode);
  const { addToWishlist, ownedPedals, wishlistPedals, retiredPedals, profile } = useStore();
  const hasProfile = Boolean(profile?.pedal_expert_profile?.onboarding_completed_at);
  const quizSteps = hasProfile
    ? [Q1_PROFILE, ...QUIZ_STEPS_SHARED]
    : [Q1_DEFAULT, ...QUIZ_STEPS_SHARED];
  const { cardRef: shareCardRef, cardData: shareCardData, triggerShare } = useShareCard();
  const [mode, setMode] = useState<Mode>(
    startMode === 'expert' ? 'expert' : startMode === 'gasOrPass' ? 'gasOrPass' : 'quiz'
  );
  const [screen, setScreen] = useState<Screen>(startMode === 'surpriseMe' ? 'loading' : 'idle');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<FinderPedal | null>(null);
  const [wishlistState, setWishlistState] = useState<'idle' | 'loading' | 'added'>('idle');
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [socialCounts, setSocialCounts] = useState<SocialCounts | null>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const reverbCache = useRef(new Map<string, FinderPedal[]>()).current;

  // Reset wishlist button and fetch image whenever a new result is shown
  useEffect(() => {
    setWishlistState('idle');
    setResultImageUrl(null);
    setSocialCounts(null);
    if (!result) return;

    // Fetch social proof counts + description in background
    const pedalId = result.pedal_id;
    if (pedalId) {
      Promise.all([
        // Community-wide vault/gas counts via SECURITY DEFINER RPC.
        // Direct user_pedals queries are RLS-filtered to the calling user's
        // own rows and would always return 0 for other users.
        supabase.rpc('get_pedal_social_counts', { p_pedal_id: pedalId }),
        // description
        !result.description
          ? supabase.from('pedals').select('description').eq('id', pedalId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]).then(([countsRes, descRes]) => {
        const row = (countsRes as { data: Array<{ vault_count: number; gas_count: number }> | null }).data?.[0];
        setSocialCounts({
          vault_count: Number(row?.vault_count ?? 0),
          gas_count:   Number(row?.gas_count   ?? 0),
        });
        const descRow = (descRes as { data: { description?: string | null } | null }).data;
        if (descRow?.description) {
          // Patch description onto result so it's available for display
          setResult(prev => prev ? { ...prev, description: descRow.description ?? null } : prev);
        }
      }).catch(() => {});
    }

    if (result.photo_url) {
      setResultImageUrl(result.photo_url);
      return;
    }

    // Fallback: search Reverb for a listing photo
    invokeEdgeFunction<SearchPedalsResponse>('search-pedals', {
      query: `${result.brand} ${result.model}`,
    })
      .then(({ data }) => {
        // Try live Reverb results first (have photo_url)
        const reverbResults = (data?.results as { photo_url?: string }[]) ?? [];
        const reverbHit = reverbResults.find(p => p.photo_url);
        if (reverbHit?.photo_url) { setResultImageUrl(reverbHit.photo_url); return; }
        // Then try local catalog fallback
        const pedals = (data?.pedals as { image_url?: string }[]) ?? [];
        const localHit = pedals.find(p => p.image_url);
        if (localHit?.image_url) setResultImageUrl(localHit.image_url);
      })
      .catch(() => {});
  }, [result]);

  const animateIn = useCallback(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(24);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: USE_NATIVE_DRIVER }),
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: USE_NATIVE_DRIVER }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const excluded = useMemo(() => {
    const set = new Set<string>();
    for (const up of [...ownedPedals, ...retiredPedals]) {
      const pedal = up.pedal;
      if (!pedal) continue;
      // ID-based exclusion — survives brand/model string mismatches
      if (up.pedal_id) set.add(`id:${up.pedal_id}`);
      // Brand+model exclusion — catches colorway variants of owned pedals
      for (const key of ownedExclusionKeys(pedal.brand, pedal.model)) {
        set.add(key);
      }
    }
    return set;
  }, [ownedPedals, retiredPedals]);

  const fetchReverbCandidates = useCallback(async (query: string) => {
    const key = query.toLowerCase().trim();
    if (reverbCache.has(key)) return reverbCache.get(key)!;
    const { data } = await invokeEdgeFunction<SearchPedalsResponse>('search-pedals', { query });
    const results = (data?.results as FinderPedal[]) ?? [];
    reverbCache.set(key, results);
    return results;
  }, [reverbCache]);

  const pickRandomFromQuery = useCallback(async (query: string) => {
    const results = await fetchReverbCandidates(query);
    const filtered = results.filter(p =>
      !(p.pedal_id && excluded.has(`id:${p.pedal_id}`)) && !isExcluded(p.brand, p.model, excluded));
    return filtered;
  }, [excluded, fetchReverbCandidates]);

  // Shared: fetch quiz candidates and show a result — used by handleAnswer and handleTryAgain
  const runQuizResult = useCallback((quizAnswers: string[]) => {
    const genre = quizAnswers[0] ?? 'all';
    const budgetMax = parseInt(quizAnswers[1] ?? '9999', 10);
    const category = quizAnswers[2] ?? 'drive';
    const query = `${GENRE_QUERY[genre] ?? 'guitar'} ${CATEGORY_QUERY[category] ?? 'pedal'}`.trim();
    setResult(null);
    setScreen('loading');
    fetchReverbCandidates(query)
      .then(results => {
        if (!results.length) {
          setScreen('idle');
          Alert.alert('No suggestions right now', NO_RESULTS_MSG);
          return;
        }
        const best = findBestMatch(genre, budgetMax, category, excluded, results);
        setResult(best);
        setScreen('result');
        setTimeout(animateIn, 50);
      })
      .catch(() => {
        setScreen('idle');
        Alert.alert('No suggestions right now', NO_RESULTS_MSG);
      });
  }, [fetchReverbCandidates, excluded, animateIn]);

  const handleReset = useCallback(() => {
    Haptics.selectionAsync();
    setScreen('idle');
    setStep(0);
    setAnswers([]);
    setResult(null);
  }, []);

  // handleBackToIdle is the same operation — reuse handleReset
  const handleBackToIdle = handleReset;

  const SURPRISE_CATEGORIES = ['drive', 'delay', 'reverb', 'modulation', 'ambient', 'looper', 'pitch'];

  const handleSurpriseMe = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setResult(null);
    setScreen('loading');

    const shuffled = [...SURPRISE_CATEGORIES].sort(() => Math.random() - 0.5);

    // ── Pass 1: Reverb (has photos, fresh data) ────────────────────────────────
    for (const category of shuffled.slice(0, 4)) {
      try {
        const query = CATEGORY_QUERY[category] ?? `${category} pedal`;
        const candidates = await fetchReverbCandidates(query);
        const available = candidates.filter(p =>
          !(p.pedal_id && excluded.has(`id:${p.pedal_id}`)) && !isExcluded(p.brand, p.model, excluded),
        );
        if (available.length > 0) {
          // Prefer candidates with photos but don't require them
          const withPhoto = available.filter(p => p.photo_url);
          const pool = withPhoto.length > 0 ? withPhoto : available;
          const random = pool[Math.floor(Math.random() * pool.length)];
          setResult(random);
          setScreen('result');
          setTimeout(animateIn, 50);
          return;
        }
      } catch {
        // Try next category
      }
    }

    // ── Pass 2: Local catalog fallback (always available offline) ─────────────
    try {
      const { data: localPedals } = await supabase
        .from('pedals')
        .select('id, brand, model, category, avg_price, image_url')
        .in('category', shuffled.slice(0, 3))
        .limit(60);

      if (localPedals && localPedals.length > 0) {
        const available = localPedals.filter(p =>
          !excluded.has(`id:${p.id}`) && !isExcluded(p.brand, p.model, excluded),
        );
        if (available.length > 0) {
          const random = available[Math.floor(Math.random() * available.length)];
          setResult({
            brand: random.brand,
            model: random.model,
            category: random.category,
            avg_price: random.avg_price ?? null,
            photo_url: random.image_url ?? null,
            in_catalog: true,
            pedal_id: random.id,
          });
          setScreen('result');
          setTimeout(animateIn, 50);
          return;
        }
      }
    } catch {
      // Fall through
    }

    setScreen('idle');
    Alert.alert('No suggestions right now', "Your vault covers a lot of ground! Try a different category.");
  };

  // When navigated from AIHub with startMode='surpriseMe', fire once on mount
  const surpriseFiredRef = useRef(false);
  useEffect(() => {
    if (startMode === 'surpriseMe' && !surpriseFiredRef.current) {
      surpriseFiredRef.current = true;
      handleSurpriseMe();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartQuiz = () => {
    Haptics.selectionAsync();
    setStep(0);
    setAnswers([]);
    setScreen('quiz');
    setTimeout(animateIn, 50);
  };

  const handleAnswer = (value: string) => {
    Haptics.selectionAsync();
    const newAnswers = [...answers, value];
    setAnswers(newAnswers);

    if (step < quizSteps.length - 1) {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: USE_NATIVE_DRIVER }).start();
      setStep(step + 1);
    } else {
      runQuizResult(newAnswers);
    }
  };

  const handleTryAgain = async () => {
    Haptics.selectionAsync();
    if (answers.length === quizSteps.length) {
      // Re-run with same answers — picks a different pedal from the top 3
      runQuizResult(answers);
    } else {
      // Came from Surprise Me — pick a new random pedal
      await handleSurpriseMe();
    }
  };

  const handleAddToWishlist = useCallback(async () => {
    if (!result || wishlistState !== 'idle') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setWishlistState('loading');
    const outcome = await addToWishlist(result.brand, result.model, {
      category: result.category,
      subcategory: 'Recommended',
      description: result.description ?? '',
      analog: false,
      price: result.avg_price ?? null,
    });
    if (outcome === 'added') {
      setWishlistState('added');
    } else if (outcome === 'exists') {
      setWishlistState('added'); // already there — treat as success
    } else if (outcome === 'not_found') {
      setWishlistState('idle');
      Alert.alert('Not in catalog yet', 'This pedal isn\'t in the database yet. You can add it manually from the Collection tab.');
    } else {
      setWishlistState('idle');
      Alert.alert('Something went wrong', 'Could not add to wishlist. Please try again.');
    }
  }, [result, wishlistState, addToWishlist]);

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>TPC.ai</Text>
        <Text style={styles.headerSub}>Expert tools powered by Claude</Text>
        <View style={styles.headerFeatureCard}>
          <Text style={styles.headerFeatureLabel}>PEDAL FINDER</Text>
          <Text style={styles.headerFeatureTitle}>Discover your perfect next pedal</Text>
        </View>
      </View>

      {/* ── Expert Mode (full-screen) ── */}
      {mode === 'expert' && (
        <ExpertMode onBack={() => fromHub ? navigation.goBack() : setMode('quiz')} />
      )}

      {/* ── GAS or Pass mode ── */}
      {mode === 'gasOrPass' && (
        <GasOrPassMode
          onBack={() => fromHub ? navigation.goBack() : setMode('quiz')}
          ownedPedals={ownedPedals}
          wishlistPedals={wishlistPedals}
          retiredPedals={retiredPedals}
          addToWishlist={addToWishlist}
          profile={profile}
        />
      )}

      {/* ── Quiz / Idle / Result ── */}
      {mode === 'quiz' && (
      <ScrollView
        style={styles.quizScroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
      <View style={styles.body}>
        {/* ─── Idle State — 3 pills ─── */}
        {screen === 'idle' && (
          <View style={styles.idleContainer}>
            {/* Custom Shop */}
            <TouchableOpacity
              style={{ flex: 1 }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setMode('expert');
              }}
              activeOpacity={0.85}
            >
              <LinearGradient colors={['#3D5261', '#2A3E4E']} style={styles.pill}>
                <View style={styles.pillIconWrapDark}>
                  <Ionicons name="sparkles-outline" size={22} color="#FFFFFF" />
                </View>
                <View style={styles.pillTextBlock}>
                  <Text style={styles.pillTitle}>Custom Shop</Text>
                  <Text style={styles.pillSub}>Expertly-curated for your tone & style</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.65)" />
              </LinearGradient>
            </TouchableOpacity>

            {/* Surprise Me */}
            <TouchableOpacity style={{ flex: 1 }} onPress={handleSurpriseMe} activeOpacity={0.85}>
              <LinearGradient colors={gradients.teal} style={styles.pill}>
                <View style={styles.pillIconWrapDark}>
                  <Ionicons name="shuffle-outline" size={22} color="#FFFFFF" />
                </View>
                <View style={styles.pillTextBlock}>
                  <Text style={styles.pillTitle}>Surprise Me</Text>
                  <Text style={styles.pillSub}>Completely random, outside your collection</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.65)" />
              </LinearGradient>
            </TouchableOpacity>

            {/* GAS or Pass */}
            <TouchableOpacity
              style={{ flex: 1 }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setMode('gasOrPass');
              }}
              activeOpacity={0.85}
            >
              <LinearGradient colors={[colors.rose, colors.roseDark]} style={styles.pill}>
                <View style={styles.pillIconWrapDark}>
                  <Ionicons name="flame-outline" size={22} color="#FFFFFF" />
                </View>
                <View style={styles.pillTextBlock}>
                  <Text style={styles.pillTitle}>GAS or Pass</Text>
                  <Text style={styles.pillSub}>Swipe through pedals you don't own yet</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.65)" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── Quiz State ─── */}
        {screen === 'quiz' && (
          <Animated.View
            style={[
              styles.quizContainer,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <TouchableOpacity onPress={handleBackToIdle} style={styles.topBackBtn}>
              <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
              <Text style={styles.topBackText}>Back</Text>
            </TouchableOpacity>
            {/* Progress */}
            <View style={styles.progressRow}>
              {quizSteps.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.progressDot,
                    i <= step && styles.progressDotActive,
                    i < step && styles.progressDotDone,
                  ]}
                />
              ))}
            </View>

            {/* Question card */}
            <View style={styles.questionCard}>
              <Text style={styles.questionEmoji}>{quizSteps[step].emoji}</Text>
              <Text style={styles.questionText}>{quizSteps[step].question}</Text>
            </View>

            {/* Options */}
            <View style={styles.optionsList}>
              {quizSteps[step].options.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={styles.optionBtn}
                  onPress={() => handleAnswer(opt.value)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.optionBtnText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity onPress={handleReset} style={styles.backBtn}>
              <Text style={styles.backBtnText}>← Start Over</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ─── Loading State ─── */}
        {screen === 'loading' && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.teal} />
            <Text style={styles.loadingText}>Searching Reverb…</Text>
          </View>
        )}

        {/* ─── Result State ─── */}
        {screen === 'result' && result && (
          <Animated.View
            style={[
              styles.resultContainer,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <TouchableOpacity onPress={handleBackToIdle} style={styles.topBackBtn}>
              <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
              <Text style={styles.topBackText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.resultLabel}>YOUR MATCH</Text>

            {/* Result card */}
            <LinearGradient
              colors={['#FFFFFF', '#F2EDE7']}
              style={styles.resultCard}
            >
              {/* Photo banner or color bar */}
              {resultImageUrl ? (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setShowImageModal(true)}>
                  <Image
                    source={{ uri: resultImageUrl }}
                    style={styles.resultImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ) : (
                <View
                  style={[
                    styles.resultImagePlaceholder,
                    { backgroundColor: (categoryColors[result.category] ?? colors.textMuted) + '22' },
                  ]}
                >
                  <Text style={styles.resultImageEmoji}>🎛</Text>
                </View>
              )}

              <View style={styles.resultCardBody}>
                <View style={styles.resultTop}>
                  <View style={styles.resultTopText}>
                    <CategoryBadge category={result.category} />
                    <Text style={styles.resultBrand}>{result.brand}</Text>
                  </View>
                </View>

                <Text style={styles.resultModel}>{result.model}</Text>

                {result.description ? (
                  <Text style={styles.resultDescription} numberOfLines={3}>
                    {result.description}
                  </Text>
                ) : null}

                <View style={styles.resultMeta}>
                  {result.avg_price != null && (
                    <View style={styles.resultPriceBadge}>
                      <Text style={styles.resultPrice}>${result.avg_price}</Text>
                    </View>
                  )}
                </View>

                {socialCounts && (socialCounts.vault_count > 0 || socialCounts.gas_count > 0) ? (
                  <View style={styles.socialRow}>
                    {socialCounts.vault_count > 0 && (
                      <View style={styles.socialChip}>
                        <Ionicons name="cube-outline" size={12} color={colors.teal} />
                        <Text style={styles.socialChipText}>
                          {socialCounts.vault_count} in vaults
                        </Text>
                      </View>
                    )}
                    {socialCounts.gas_count > 0 && (
                      <View style={styles.socialChip}>
                        <Ionicons name="flame-outline" size={12} color={colors.rose} />
                        <Text style={[styles.socialChipText, { color: colors.rose }]}>
                          {socialCounts.gas_count} want this
                        </Text>
                      </View>
                    )}
                  </View>
                ) : null}
              </View>
            </LinearGradient>

            {/* Actions */}
            <View style={styles.resultActions}>
              <TouchableOpacity style={styles.resultActionSecondary} onPress={handleTryAgain} activeOpacity={0.75}>
                <Text style={styles.resultActionSecondaryText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resultActionPrimary}
                activeOpacity={0.8}
                onPress={handleAddToWishlist}
                disabled={wishlistState !== 'idle'}
              >
                <LinearGradient
                  colors={wishlistState === 'added' ? ['#1A8C40', '#157033'] : gradients.teal}
                  style={styles.resultActionGrad}
                >
                  {wishlistState === 'loading' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.resultActionPrimaryText}>
                      {wishlistState === 'added' ? '✓ Added to GAS List' : 'Add to GAS List'}
                    </Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>

            {/* Share pick — image card (Instagram/TikTok) + text fallback */}
            <View style={styles.shareRow}>
              <TouchableOpacity
                style={styles.sharePickBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  triggerShare({ type: 'pick', brand: result.brand, model: result.model, why: `${result.brand} ${result.model} — recommended for my rig by TPC` });
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="share-social-outline" size={15} color={colors.teal} />
                <Text style={styles.sharePickText}>Share as Image</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sharePickBtnText}
                onPress={() => {
                  Haptics.selectionAsync();
                  shareRecommendation(result.brand, result.model, `${result.brand} ${result.model} — recommended for my rig by TPC`);
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="share-outline" size={14} color={colors.textMuted} />
                <Text style={styles.sharePickTextMuted}>Text</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        <Modal
          visible={showImageModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowImageModal(false)}
        >
          <View style={styles.imageModalBackdrop}>
            <TouchableOpacity
              style={styles.imageModalBackdrop}
              activeOpacity={1}
              onPress={() => setShowImageModal(false)}
            />
            <View style={styles.imageModalContent}>
              {resultImageUrl && (
                <Image
                  source={{ uri: resultImageUrl }}
                  style={styles.imageModalImage}
                  resizeMode="contain"
                />
              )}
              <TouchableOpacity
                style={styles.imageModalClose}
                onPress={() => setShowImageModal(false)}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
      </ScrollView>
      )}
      <HiddenShareCard cardRef={shareCardRef} cardData={shareCardData} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  quizScroll: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    marginBottom: spacing.xs,
    gap: 6,
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
    marginBottom: spacing.sm,
  },
  headerFeatureCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 4,
  },
  headerFeatureLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    letterSpacing: 1.1,
    color: colors.teal,
  },
  headerFeatureTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
  },
  body: {
    padding: spacing.base,
    flex: 1,
  },
  loadingContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  // Idle — 3 pills
  idleContainer: {
    flex: 1,
    gap: spacing.md,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  pillLight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillIconWrapDark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
  },
  pillIconWrapLight: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal + '12',
    borderWidth: 1,
    borderColor: colors.teal + '55',
  },
  pillTextBlock: {
    flex: 1,
    gap: 6,
  },
  pillTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: '#fff',
  },
  pillSub: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 19,
  },
  pillTitleDark: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  pillSubDark: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  // Quiz
  quizContainer: {
    gap: spacing.lg,
  },
  topBackBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xs,
  },
  topBackText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  progressDotActive: {
    backgroundColor: colors.teal,
    width: 20,
  },
  progressDotDone: {
    backgroundColor: colors.teal + '60',
    width: 8,
  },
  questionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  questionEmoji: {
    fontSize: 44,
  },
  questionText: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 28,
  },
  optionsList: {
    gap: spacing.sm,
  },
  optionBtn: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  optionBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
  },
  backBtn: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
  },
  backBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  // Result
  resultContainer: {
    gap: spacing.lg,
  },
  resultLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  resultCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  resultImage: {
    width: '100%',
    height: 200,
  },
  resultImagePlaceholder: {
    width: '100%',
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultImageEmoji: {
    fontSize: 48,
  },
  resultCardBody: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  resultTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  resultTopText: {
    gap: spacing.xs,
  },
  resultBrand: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  resultModel: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
    lineHeight: 30,
  },
  resultSubcategory: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
    marginTop: -4,
  },
  resultMeta: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  resultPriceBadge: {
    backgroundColor: colors.teal + '20',
    borderWidth: 1,
    borderColor: colors.teal + '50',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  resultPrice: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  resultDescription: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  socialRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  socialChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.teal + '12',
    borderWidth: 1,
    borderColor: colors.teal + '30',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  socialChipText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  resultActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  resultActionSecondary: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultActionSecondaryText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  resultActionPrimary: {
    flex: 2,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  resultActionGrad: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultActionPrimaryText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  sharePickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  sharePickText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  sharePickBtnText: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
  },
  sharePickTextMuted: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  imageModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageModalContent: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageModalImage: {
    width: '92%',
    height: '80%',
  },
  imageModalClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
