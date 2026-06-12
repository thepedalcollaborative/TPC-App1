// Expert Mode — AI-powered pedal recommendation flow.
// Stage 1: Player profile onboarding (via PlayerOnboarding component — 11 questions)
// Stage 2: Collection analysis + coverage bars
// Stage 3: Deep-dive AI interview (4 questions)
// Stage 4: Personalized pedal recommendation with community signals

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Linking,
  Alert,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';
import { useStore } from '../hooks/useStore';
import { supabase, invokeEdgeFunction } from '../lib/supabase';
import { hasBetaFullAccess } from '../lib/subscription';
import { askClaudeOnce } from '../lib/anthropic';
import { loadMemory, refreshMemory } from '../lib/memory';
import type { UserPedal, FullExpertProfile } from '../lib/supabase';
import { reverbSearchUrl } from '../lib/reverb';
import { GEAR_KNOWLEDGE_BASE } from '../lib/gearKnowledge';
import { shareSoundDNA } from '../lib/share';
import { PlayerOnboarding } from './PlayerOnboarding';
import { HiddenShareCard } from './ShareCard';
import { SocialShareSheet } from './index';
import { useShareCard } from '../lib/useShareCard';
import { captureRef } from 'react-native-view-shot';
import Svg, { Polygon, Line, Circle, Text as SvgText, TSpan } from 'react-native-svg';

// ─── Types ────────────────────────────────────────────────────────────────────

type SpiderValues = {
  drive: number;
  modulation: number;
  timeSpace: number;
  dynamics: number;
  loopersMulti: number;
  experimental: number;
  utility: number;
};

type InterviewQuestion = {
  question: string;
  options: string[];
};

type Recommendation = {
  brand: string;
  model: string;
  why: string;
  fitsRig: string;
  fillsGap: string;
  boutiqueAngle: string;
  keyFeatures: string[];
  estimatedPrice: string;
  whereToFind: string;
  alsoConsider: { brand: string; model: string; note: string }[];
  deepCut: { brand: string; model: string; note: string; whereToFind: string } | null;
  onWishlist: string;
};

type ExpertStage =
  | 'loading_profile'
  | 'onboarding'
  | 'profile_refresh'
  | 'analyzing'
  | 'analysis'
  | 'interview'
  | 'thinking'
  | 'recommendation'
  | 'regenerating';

type FeedbackState = 'idle' | 'rejected_picking' | 'done';

// ─── Collection Coverage Axes ─────────────────────────────────────────────────

const SPIDER_AXES = [
  { key: 'drive' as keyof SpiderValues, label: 'Drive/Dirt', categories: ['drive', 'boost'], emoji: '🔥', color: colors.drive },
  { key: 'modulation' as keyof SpiderValues, label: 'Modulation', categories: ['modulation', 'pitch'], emoji: '🌊', color: colors.modulation },
  { key: 'timeSpace' as keyof SpiderValues, label: 'Time/Space', categories: ['delay', 'reverb', 'ambient'], emoji: '✨', color: colors.reverb },
  { key: 'dynamics' as keyof SpiderValues, label: 'Dynamics', categories: ['compressor', 'eq'], emoji: '⚡', color: colors.compressor },
  { key: 'loopersMulti' as keyof SpiderValues, label: 'Loopers/Multi', categories: ['looper', 'multifx', 'modeler'], emoji: '🔄', color: colors.looper },
  { key: 'experimental' as keyof SpiderValues, label: 'Experimental', categories: ['synth', 'other'], emoji: '🎲', color: colors.ambient },
  { key: 'utility' as keyof SpiderValues, label: 'Utility', categories: ['utility'], emoji: '🔧', color: colors.utility },
];

const REJECTION_REASONS = [
  'Too safe / not weird enough',
  'Too weird / not practical enough',
  'Wrong price range',
  'Already tried it',
  'Wrong for my rig',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calculateSpiderValues(pedals: UserPedal[]): SpiderValues {
  const owned = pedals.filter(p => p.status === 'owned');
  const counts: Record<string, number> = {};
  for (const up of owned) {
    const cat = up.pedal?.category ?? up.category_override ?? '';
    if (cat) counts[cat] = (counts[cat] ?? 0) + 1;
  }
  function axisScore(categories: readonly string[]): number {
    const total = categories.reduce((sum, cat) => sum + (counts[cat] ?? 0), 0);
    if (total === 0) return 0;
    if (total === 1) return 3;
    if (total === 2) return 5.5;
    if (total === 3) return 7.5;
    return Math.min(9.5, 7.5 + (total - 3) * 0.5);
  }
  return {
    drive: axisScore(['drive', 'boost']),
    modulation: axisScore(['modulation', 'pitch']),
    timeSpace: axisScore(['delay', 'reverb', 'ambient']),
    dynamics: axisScore(['compressor', 'eq']),
    loopersMulti: axisScore(['looper', 'multifx', 'modeler']),
    experimental: axisScore(['synth', 'other']),
    utility: axisScore(['utility']),
  };
}

function formatCollection(pedals: UserPedal[]): string {
  const owned = pedals.filter(p => p.status === 'owned');
  if (owned.length === 0) return 'No pedals in collection yet.';
  return owned.map(up => {
    const p = up.pedal;
    return p ? `${p.brand} ${p.model} (${p.category})` : 'Unknown pedal';
  }).join(', ');
}

function formatWishlist(pedals: UserPedal[]): string {
  if (pedals.length === 0) return 'Empty';
  return pedals.map(up => {
    const p = up.pedal;
    return p ? `${p.brand} ${p.model}` : 'Unknown';
  }).join(', ');
}

function formatRetiredPedals(pedals: UserPedal[]): string {
  if (pedals.length === 0) return 'None';
  return pedals.map(up => {
    const name = up.pedal ? `${up.pedal.brand} ${up.pedal.model}` : 'Unknown';
    // retired_notes may start with "REASON: X\n..." — extract cleanly
    const notes = up.retired_notes ?? '';
    const reasonMatch = notes.match(/^REASON:\s*(.+?)(\n|$)/i);
    const reason = reasonMatch ? reasonMatch[1].trim() : (notes.split('\n')[0] || 'Moved on');
    return `${name} (${reason})`;
  }).join(', ');
}

function formatFullProfile(profile: FullExpertProfile): string {
  const budgetLabels: Record<string, string> = {
    under_100: 'Under $100',
    '100_175': '$100–$175',
    '175_300': '$175–$300',
    '300_500': '$300–$500',
    no_ceiling: 'No ceiling',
  };
  const guitarLabels: Record<string, string> = {
    single_coils: 'Single coils (Strat, Tele, Jazzmaster)',
    humbuckers: 'Humbuckers (Les Paul, 335, SG)',
    p90s: 'P90s',
    mix: 'Mix / multiple guitars',
  };
  const ampLabels: Record<string, string> = {
    clean_platform: 'Clean platform (Fender-style)',
    natural_breakup: 'Natural breakup (Vox, tweed)',
    high_gain: 'High gain (Mesa, Marshall)',
    modeler: 'Modeler / direct (Kemper, HX Stomp)',
    no_amp: 'No amp / straight to interface',
  };

  return [
    `Tone in three words: ${profile.tone_identity || '(not provided)'}`,
    `Guitar heroes: ${profile.guitar_heroes || '(not provided)'}`,
    `Experience: ${profile.experience_years}`,
    `Guitar: ${guitarLabels[profile.guitar_type] ?? profile.guitar_type}`,
    `Amp: ${ampLabels[profile.amp_type] ?? profile.amp_type}`,
    `Genres: ${profile.genres.join(', ')}`,
    `Board philosophy: ${profile.board_philosophy}`,
    `Brand attitude: ${profile.brand_attitude}`,
    `Complexity tolerance: ${profile.complexity_tolerance}`,
    `Budget: ${budgetLabels[profile.budget_range] ?? profile.budget_range}`,
    `Sonic moments that hook them: ${profile.sonic_moments.join(', ')}`,
    `The chase: ${profile.tone_chase || '(not provided)'}`,
  ].join('\n');
}


const tpcLogo = require('../../assets/tpc-final.png');

// ─── Spider Web Chart ─────────────────────────────────────────────────────────
// Labels are rendered as absolutely-positioned Text components (not SVG text)
// so they never clip regardless of screen size — SVG only draws grid + polygon.
//
// Layout:
//   CONTAINER_SIZE × CONTAINER_SIZE outer View (positions labels absolutely)
//   SVG_SIZE × SVG_SIZE centered inside it (grid rings, spokes, polygon, dots)
//   Labels positioned at LABEL_R from SVG centre, converted to container coords

const SVG_SIZE     = 210;
const SVG_CENTER   = SVG_SIZE / 2;        // 105
const MAX_R        = 78;                  // polygon radius at score = 10
const LABEL_R      = 118;                 // label-centre radius from SVG centre
const CONTAINER_SIZE = 350;              // outer container (labels live here)
const SVG_OFFSET   = (CONTAINER_SIZE - SVG_SIZE) / 2;  // 70 — SVG inset each side

const CHART_LABELS: Record<keyof SpiderValues, string> = {
  drive:        'Drive',
  modulation:   'Modulation',
  timeSpace:    'Time/Space',
  dynamics:     'Dynamics',
  loopersMulti: 'Loopers',
  experimental: 'Experimental',
  utility:      'Utility',
};

function getPoint(axisIndex: number, totalAxes: number, radius: number, cx = SVG_CENTER, cy = SVG_CENTER): [number, number] {
  const angle = ((360 / totalAxes) * axisIndex - 90) * (Math.PI / 180);
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function ptsToStr(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function SpiderChart({ values, animate = true }: { values: SpiderValues; animate?: boolean }) {
  const gridScale  = useRef(new Animated.Value(animate ? 0.15 : 1)).current;
  const valueScale = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!animate || hasAnimated.current) return;
    hasAnimated.current = true;
    Animated.spring(gridScale, { toValue: 1, tension: 40, friction: 8, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.spring(valueScale, { toValue: 1, tension: 60, friction: 6, useNativeDriver: true })
        .start(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
    }, 420);
  }, []);

  const n = SPIDER_AXES.length;
  const rings = [2, 4, 6, 8, 10].map(s => SPIDER_AXES.map((_, i) => getPoint(i, n, (s / 10) * MAX_R)));
  const outerRing = rings[4];
  const valuePolygon = SPIDER_AXES.map((axis, i) =>
    getPoint(i, n, Math.max(3, (values[axis.key] / 10) * MAX_R))
  );

  return (
    <View style={{ width: CONTAINER_SIZE, height: CONTAINER_SIZE }}>

      {/* ── Grid + rings — springs in ── */}
      <Animated.View style={[chartStyles.svgLayer, { transform: [{ scale: gridScale }] }]}>
        <Svg width={SVG_SIZE} height={SVG_SIZE}>
          {rings.map((ring, ri) => (
            <Polygon key={`ring-${ri}`} points={ptsToStr(ring)} fill="none"
              stroke={colors.border} strokeWidth={ri === 4 ? 1.5 : 0.7} opacity={ri === 4 ? 0.9 : 0.4} />
          ))}
          {outerRing.map(([x, y], i) => (
            <Line key={`spoke-${i}`} x1={SVG_CENTER} y1={SVG_CENTER} x2={x} y2={y}
              stroke={colors.border} strokeWidth={0.7} opacity={0.45} />
          ))}
        </Svg>
      </Animated.View>

      {/* ── Value polygon — pops in after grid ── */}
      <Animated.View style={[chartStyles.svgLayer, { transform: [{ scale: valueScale }], opacity: valueScale }]}>
        <Svg width={SVG_SIZE} height={SVG_SIZE}>
          <Polygon points={ptsToStr(valuePolygon)} fill={colors.teal + '30'}
            stroke={colors.teal} strokeWidth={2.5} strokeLinejoin="round" />
          {SPIDER_AXES.map((axis, i) => {
            const [cx, cy] = valuePolygon[i];
            const score = values[axis.key];
            return (
              <Circle key={`dot-${i}`} cx={cx} cy={cy} r={score > 0 ? 6 : 3}
                fill={score > 0 ? axis.color : colors.border} stroke="#fff" strokeWidth={1.5} />
            );
          })}
        </Svg>
      </Animated.View>

      {/* ── Labels — React Native Text, absolutely positioned ── */}
      {SPIDER_AXES.map((axis, i) => {
        // Label centre in container coordinates
        const angle = ((360 / n) * i - 90) * (Math.PI / 180);
        const lx = SVG_OFFSET + SVG_CENTER + LABEL_R * Math.cos(angle);
        const ly = SVG_OFFSET + SVG_CENTER + LABEL_R * Math.sin(angle);

        const score = values[axis.key];
        // Box centred on (lx, ly). 96px wide handles "Modulation" at 10px bold.
        const BOX_W = 96; const BOX_H = 52;
        return (
          <View
            key={axis.key}
            style={{
              position: 'absolute',
              left: lx - BOX_W / 2,
              top:  ly - BOX_H / 2,
              width: BOX_W,
              height: BOX_H,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={chartStyles.labelEmoji}>{axis.emoji}</Text>
            <Text style={[chartStyles.labelText, { color: score >= 5 ? colors.textPrimary : colors.textSecondary }]}>
              {CHART_LABELS[axis.key]}
            </Text>
            <Text style={[chartStyles.labelScore, { color: score >= 5 ? axis.color : colors.textMuted }]}>
              {score.toFixed(1)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  svgLayer: {
    position: 'absolute',
    top: SVG_OFFSET,
    left: SVG_OFFSET,
  },
  labelEmoji: {
    fontSize: 15,
    lineHeight: 17,
  },
  labelText: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    textAlign: 'center',
    lineHeight: 12,
  },
  labelScore: {
    fontSize: 11,
    fontFamily: typography.bodySemiBold,
    textAlign: 'center',
    lineHeight: 14,
  },
});

// ─── Main Component ───────────────────────────────────────────────────────────

type Props = {
  onBack: () => void;
};

export function ExpertMode({ onBack }: Props) {
  const { ownedPedals, wishlistPedals, retiredPedals, addToWishlist, profile: storeProfile, openPaywall, setLastCustomShopPick } = useStore();

  const [stage, setStage] = useState<ExpertStage>('loading_profile');
  const [profile, setProfile] = useState<FullExpertProfile | null>(null);
  const [spiderValues, setSpiderValues] = useState<SpiderValues | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([]);
  const [interviewStep, setInterviewStep] = useState(0);
  const [interviewAnswers, setInterviewAnswers] = useState<{ question: string; answer: string }[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [wishlistState, setWishlistState] = useState<'idle' | 'loading' | 'added'>('idle');
  const [hasExistingProfile, setHasExistingProfile] = useState(false);
  const [feedbackState, setFeedbackState] = useState<FeedbackState>('idle');
  const [communitySignal, setCommunitySignal] = useState('');
  const [previousRecommendations, setPreviousRecommendations] = useState<{ brand: string; model: string }[]>([]);
  const [playerMemory, setPlayerMemory] = useState('');
  const playerMemoryRef = useRef('');
  // Single-run ticket from custom-shop-gate — required by tpc-advisor for
  // all custom_shop-purpose calls (analysis, questions, final pick).
  const runTicketRef = useRef<string | null>(null);

  const { cardRef, cardData, triggerShare } = useShareCard();
  const chartRef = useRef<View>(null);
  const [chartShareOpen, setChartShareOpen] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const fadeIn = useCallback(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    loadProfile();
  }, []);

  // ── Load profile ───────────────────────────────────────────────────────────
  const loadProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setStage('onboarding'); fadeIn(); return; }

      // Load player memory in background (non-blocking)
      loadMemory(session.user.id).then(m => {
        setPlayerMemory(m);
        playerMemoryRef.current = m;
      });

      const { data } = await supabase
        .from('user_profiles')
        .select('pedal_expert_profile')
        .eq('id', session.user.id)
        .single();

      const saved = data?.pedal_expert_profile as FullExpertProfile | null;

      if (saved?.onboarding_completed_at) {
        setProfile(saved);
        setHasExistingProfile(true);

        // Check if profile refresh is due
        if (saved.profile_refresh_due_at) {
          const refreshDue = new Date(saved.profile_refresh_due_at);
          if (refreshDue < new Date()) {
            setStage('profile_refresh');
            fadeIn();
            return;
          }
        }
        runAnalysis(saved, true);
      } else {
        setStage('onboarding');
        fadeIn();
      }
    } catch {
      setStage('onboarding');
      fadeIn();
    }
  };

  const saveProfile = async (finalProfile: FullExpertProfile) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase
        .from('user_profiles')
        .update({ pedal_expert_profile: finalProfile })
        .eq('id', session.user.id);
    } catch {}
  };

  const updateRefreshTimer = async (addMonths: number) => {
    if (!profile) return;
    const newDate = new Date();
    newDate.setMonth(newDate.getMonth() + addMonths);
    const updated: FullExpertProfile = {
      ...profile,
      profile_refresh_due_at: newDate.toISOString(),
      profile_updated_at: new Date().toISOString(),
    };
    setProfile(updated);
    await saveProfile(updated);
  };

  // ── Community signals ──────────────────────────────────────────────────────
  const fetchCommunitySignals = async (spider: SpiderValues): Promise<string> => {
    try {
      const gapCategories = SPIDER_AXES
        .filter(a => (spider[a.key] ?? 0) < 4)
        .flatMap(a => a.categories);

      const collectionIds = ownedPedals
        .filter(p => p.status === 'owned')
        .map(p => p.pedal_id)
        .filter(Boolean);

      const { data } = await invokeEdgeFunction<{ signals: string }>('community-signals', {
        action: 'query',
        collection_pedal_ids: collectionIds,
        gap_categories: gapCategories,
        profile_genres: profile?.genres ?? [],
        profile_guitar_type: profile?.guitar_type ?? '',
      });

      return data?.signals ?? '';
    } catch {
      return '';
    }
  };

  // ── Analysis ───────────────────────────────────────────────────────────────
  const runAnalysis = async (expertProfile: FullExpertProfile, skipInterview = false) => {
    // Gate: server-side check — beta users bypass, everyone else hits the RPC.
    // consume_custom_shop_run() atomically validates is_premium and the free-tier
    // lifetime run limit, so AsyncStorage cannot be cleared to bypass it.
    if (!hasBetaFullAccess()) {
      const { data: gateData, error: gateErr } = await invokeEdgeFunction<{
        allowed: boolean;
        error?: string;
        isFirstRun?: boolean;
        ticket?: string;
      }>('custom-shop-gate', {});

      if (gateErr || !gateData?.allowed || !gateData.ticket) {
        openPaywall('custom_shop');
        return;
      }
      runTicketRef.current = gateData.ticket;
    }

    setStage('analyzing');
    const spider = calculateSpiderValues(ownedPedals);
    setSpiderValues(spider);

    const collectionSummary = formatCollection(ownedPedals);
    const profileSummary = formatFullProfile(expertProfile);
    const hasPedals = ownedPedals.filter(p => p.status === 'owned').length > 0;

    const analysisPrompt = hasPedals
      ? `You are a guitar effects expert. Analyze this guitarist's collection and profile.\n\nPlayer profile:\n${profileSummary}\n\nCurrent pedal collection: ${collectionSummary}\n\nCollection coverage (0-10):\n${SPIDER_AXES.map(a => `${a.label}: ${spider[a.key].toFixed(1)}`).join('\n')}\n\nWrite 2-3 sentences about their collection: what they're strong in, what's missing, and what their sound profile suggests. Be specific and reference their guitar heroes or tone identity if provided. Under 70 words.`
      : `You are a guitar effects expert. This guitarist is just starting out.\n\nPlayer profile:\n${profileSummary}\n\nThey have no pedals yet. Write 2-3 welcoming sentences about where to start based on their profile, referencing their tone identity or guitar heroes if provided. Under 60 words, end with enthusiasm.`;

    // skipInterview is passed in as a param to avoid React state batching timing issues

    const [analysisResult, questionsResult] = await Promise.all([
      askClaudeOnce(
        analysisPrompt,
        'You are a concise, knowledgeable guitar effects advisor. Respond with plain text, no markdown.',
        { purpose: 'custom_shop', ticket: runTicketRef.current ?? undefined }
      ),
      skipInterview ? Promise.resolve([] as InterviewQuestion[]) : generateInterviewQuestions(expertProfile, collectionSummary),
    ]);

    setAnalysisText(analysisResult);
    setInterviewQuestions(questionsResult);
    setInterviewStep(0);
    setInterviewAnswers([]);
    setStage('analysis');   // skip interview when profile exists — go straight to spider reveal
    fadeIn();
  };

  const generateInterviewQuestions = async (
    expertProfile: FullExpertProfile,
    collectionSummary: string
  ): Promise<InterviewQuestion[]> => {
    const profileSummary = formatFullProfile(expertProfile);
    const prompt = `You are a guitar effects expert about to recommend a pedal for a specific player.\n\nPlayer profile:\n${profileSummary}\n\nCollection: ${collectionSummary}\n\nGenerate exactly 4 insightful multiple-choice questions to understand what pedal to recommend. Make the questions specific to this player's guitar heroes, tone identity, and gaps. Each question must have exactly 4 options.\n\nReturn ONLY valid JSON, no markdown:\n[\n  {"question": "...", "options": ["...", "...", "...", "..."]},\n  {"question": "...", "options": ["...", "...", "...", "..."]},\n  {"question": "...", "options": ["...", "...", "...", "..."]},\n  {"question": "...", "options": ["...", "...", "...", "..."]}\n]`;

    try {
      const result = await askClaudeOnce(
        prompt,
        'You are a guitar effects expert. Return only valid JSON arrays, no markdown, no code blocks.',
        { purpose: 'custom_shop', ticket: runTicketRef.current ?? undefined }
      );
      const clean = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean) as InterviewQuestion[];
      if (Array.isArray(parsed) && parsed.length >= 4) return parsed.slice(0, 4);
    } catch {}

    return [
      { question: "What's the biggest gap in your current sound?", options: ['More grit and drive', 'Texture and atmosphere', 'Rhythm and movement', 'Dynamics and feel'] },
      { question: 'How adventurous are you willing to go with this pedal?', options: ['Classic and proven', 'Slightly left-of-center', 'Pretty experimental', 'Fully deep-end'] },
      { question: 'How important is simplicity of use?', options: ['1-2 knobs max', 'A few controls is fine', 'Happy with complex', "Don't mind menus"] },
      { question: "What's the primary use case for this new pedal?", options: ['Bread-and-butter tone', 'Lead / solo boost', 'Texture / atmosphere', 'Special sounds'] },
    ];
  };

  // ── Interview ──────────────────────────────────────────────────────────────
  const handleInterviewAnswer = (answer: string) => {
    Haptics.selectionAsync();
    const q = interviewQuestions[interviewStep];
    const newAnswers = [...interviewAnswers, { question: q.question, answer }];
    setInterviewAnswers(newAnswers);

    if (interviewStep < interviewQuestions.length - 1) {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      setInterviewStep(interviewStep + 1);
    } else {
      // Reveal the spider web — the HUZZAH moment — before generating the pick
      setStage('analysis');
      fadeIn();
    }
  };

  // ── Recommendation ─────────────────────────────────────────────────────────
  const generateRecommendation = async (
    answers: { question: string; answer: string }[],
    spider: SpiderValues,
    rejectionReason?: string,
    excludedPicks?: { brand: string; model: string }[]
  ) => {
    if (!profile) return;

    const collectionSummary = formatCollection(ownedPedals);
    const profileSummary = formatFullProfile(profile);
    const interviewSummary = answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');
    const gapSummary = SPIDER_AXES
      .filter(a => spider[a.key] < 4)
      .map(a => `${a.label}: ${spider[a.key].toFixed(1)}/10`)
      .join(', ') || 'No major gaps';
    const wishlistSummary = formatWishlist(wishlistPedals);
    const retiredSummary = formatRetiredPedals(retiredPedals);

    // Allow community signal to arrive (it was fetched concurrently)
    await new Promise(r => setTimeout(r, 200));
    const signal = communitySignal;

    const systemPrompt = `You are the Custom Shop — the expert pedal matchmaker inside The Pedal Collaborative app. You are not a chatbot. You do not have conversations. You make one definitive call.

A player has come to you because they're ready to find their next pedal. They've already talked it through with the TPC Advisor. Now it's time to commit. Your job is to study everything about them and name the one pedal that is right for this specific player at this specific moment.

## Your expertise
You have encyclopedic knowledge of every guitar pedal ever made — every major brand, every boutique builder, every micro-run maker, every cult shop with a six-month waitlist. You know what's trending on Reverb, what TGP is talking about, what r/guitarpedals is sleeping on, and what boutique builders are doing things nobody else is doing. You know gear the player has never heard of and can explain exactly why it's right for them.

Your deep gear knowledge — the specific technical and tonal expertise that informs every recommendation you make:

${GEAR_KNOWLEDGE_BASE}

## How you think
You are not making a list. You are not hedging. You are making a call — the way a master luthier recommends a guitar, or a great sommelier names a wine. You've studied:

- THE CHASE: The specific sound they've been hunting. This outweighs everything else. Your pick must directly address it.
- PROFILE: Their tone identity, guitar heroes, rig, genres, board philosophy, brand attitude, complexity tolerance, and budget. This tells you who they are.
- COLLECTION + GAPS: Where they are today and what's genuinely missing.
- WISHLIST: Pedals they already know about. Never recommend these as your primary pick.
- RETIRED PEDALS: Pedals they've tried and moved on from, and why. These tell you what doesn't work for them — never recommend them.
- INTERVIEW: Four answers they just gave you. Weight these heavily — they reveal what's front-of-mind right now.
- COMMUNITY TRENDS: What players with similar profiles and collections are gravitating toward and moving away from. Use this to confirm your pick or surface something the player wouldn't find on their own.

## Your voice
Your recommendation copy must feel written specifically for this player — not a generic pedal review. Reference their guitar heroes by name. Reference their amp. Reference their chase. Speak to them as if you've known their playing for years.

You have two additional picks in reserve:
- "Also Consider": Two strong alternatives for players who want to compare before deciding.
- "Deep Cut": One obscure, micro-run, or cult builder pick that most players would never find — for the player who wants something truly their own.

## Hard rules
- Never recommend something they own, have wishlisted, or have retired.
- Never go outside their stated budget unless the interview answers suggest otherwise.
- Never write a generic recommendation. Every sentence must reference something specific to this player.
- Return ONLY valid JSON (no markdown, no code blocks) in this exact shape:

{
  "brand": "string",
  "model": "string",
  "why": "2-3 sentences written directly to this player — reference their heroes, their chase, their rig. This is your headline argument.",
  "fitsRig": "one sentence: how this pairs specifically with their guitar type and amp",
  "fillsGap": "one sentence: which gap in their spider map this fills and why that gap matters for them",
  "boutiqueAngle": "what makes this builder special — their design philosophy, cult status, or what they do that nobody else does",
  "keyFeatures": ["feature1", "feature2", "feature3"],
  "estimatedPrice": "current street price range",
  "whereToFind": "builder direct, specific retailers, or secondary market — be specific",
  "alsoConsider": [
    {"brand": "string", "model": "string", "note": "2 sentences max — why this is a strong alternative specifically for this player"},
    {"brand": "string", "model": "string", "note": "2 sentences max — why this is a strong alternative specifically for this player"}
  ],
  "deepCut": {
    "brand": "string",
    "model": "string",
    "note": "why this obscure/micro-run/cult pick is the right move for a player like this",
    "whereToFind": "exactly where to find it — waitlist, used market, builder Instagram, etc."
  },
  "onWishlist": "one sentence acknowledging their wishlist items and why your pick is a better fit right now, or empty string if no wishlist"
}${playerMemoryRef.current ? `

## Additional player context from previous sessions
${playerMemoryRef.current}` : ''}`;

    const exclusionBlock = excludedPicks && excludedPicks.length > 0
      ? `\nPreviously rejected picks — DO NOT recommend these under any circumstances:\n${excludedPicks.map(p => `- ${p.brand} ${p.model}`).join('\n')}\n`
      : '';

    const rejectionBlock = rejectionReason
      ? `\nThe player just rejected your previous pick. Their reason: "${rejectionReason}". Your new recommendation must directly address this — if they said "too safe", go more adventurous; if "wrong price range", stay strictly within budget; if "already tried it", pick something genuinely different; if "wrong for my rig", focus harder on rig compatibility.\n`
      : '';

    const userMessage = `Player profile:
${profileSummary}

Current collection: ${collectionSummary}

Spider map gaps (categories scoring below 4): ${gapSummary}

Wishlist: ${wishlistSummary}

Retired pedals: ${retiredSummary}

Deep dive interview:
${interviewSummary}

${signal ? `${signal}\n` : ''}${exclusionBlock}${rejectionBlock}Find the ideal next pedal for this player.`;

    try {
      const { data } = await invokeEdgeFunction<{ content?: { type: string; text: string }[] }>('tpc-advisor', {
        messages: [{ role: 'user', content: userMessage }],
        systemPrompt,
        stream: false,
        maxTokens: 3000,
        model: 'claude-sonnet-4-20250514', // Custom Shop final pick — premium quality
        enableWebSearch: true,             // Lets Claude verify pricing + availability
        purpose: 'custom_shop',
        ticket: runTicketRef.current ?? undefined,
      });

      const raw = data?.content?.find(c => c.type === 'text')?.text ?? '';
      const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean) as Recommendation;
      setRecommendation(parsed);
      setWishlistState('idle');
      setFeedbackState('idle');
      setStage('recommendation');
      fadeIn();

      // Save last pick to store + AsyncStorage for home screen hero card
      if (parsed.brand && parsed.model) {
        setLastCustomShopPick({
          brand: parsed.brand,
          model: parsed.model,
          why: parsed.why ?? '',
          timestamp: new Date().toISOString(),
        });
      }

      // Background memory update — note the recommendation for future sessions
      const { data: { session: s } } = await supabase.auth.getSession();
      if (s?.user?.id && parsed.brand && parsed.model) {
        refreshMemory(s.user.id, playerMemoryRef.current, {
          userMessage: `[Custom Shop run] Player asked for a pedal recommendation.`,
          assistantMessage: `Recommended the ${parsed.brand} ${parsed.model}. Why: ${parsed.why}`,
        }).catch(() => {});
      }
    } catch {
      Alert.alert('Something went wrong', 'Could not generate a recommendation. Tap "Try Again" to retry.');
      setStage('interview');
    }
  };

  // ── Feedback ───────────────────────────────────────────────────────────────
  const logFeedback = useCallback(async (outcome: 'accepted' | 'rejected', reason: string | null) => {
    if (!recommendation) return;
    // Fire and forget
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        await supabase.from('recommendation_feedback').insert({
          user_id: session.user.id,
          pedal_brand: recommendation.brand,
          pedal_model: recommendation.model,
          outcome,
          rejection_reason: reason,
          profile_snapshot: profile,
        });
      } catch {}
    })();
  }, [recommendation, profile]);

  const handleAccept = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFeedbackState('done');
    logFeedback('accepted', null);
  };

  const handleRejectionReason = (reason: string) => {
    Haptics.selectionAsync();
    logFeedback('rejected', reason);
    if (recommendation) {
      const excluded = [...previousRecommendations, { brand: recommendation.brand, model: recommendation.model }];
      setPreviousRecommendations(excluded);
      setRecommendation(null);
      setFeedbackState('idle');
      setStage('regenerating');
      fadeIn();
      const spider = spiderValues ?? calculateSpiderValues(ownedPedals);
      generateRecommendation(interviewAnswers, spider, reason, excluded);
    } else {
      setFeedbackState('done');
    }
  };

  // ── Profile reset ──────────────────────────────────────────────────────────
  const handleResetProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase
          .from('user_profiles')
          .update({ pedal_expert_profile: null })
          .eq('id', session.user.id);
      }
    } catch {}
    setHasExistingProfile(false);
    setProfile(null);
    setStage('onboarding');
    setInterviewStep(0);
    setInterviewAnswers([]);
    setRecommendation(null);
    setPreviousRecommendations([]);
    fadeIn();
  };

  // ── Wishlist ───────────────────────────────────────────────────────────────
  const handleAddToWishlist = async () => {
    if (!recommendation || wishlistState !== 'idle') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setWishlistState('loading');
    const outcome = await addToWishlist(recommendation.brand, recommendation.model);
    if (outcome === 'added' || outcome === 'exists') {
      setWishlistState('added');
    } else {
      setWishlistState('idle');
      Alert.alert('Not in catalog yet', "This pedal isn't in our database yet. You can add it manually from the Vault tab.");
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (stage === 'loading_profile') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.teal} />
      </View>
    );
  }

  if (stage === 'analyzing') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.teal} />
        <Text style={styles.loadingTitle}>Analyzing your collection…</Text>
        <Text style={styles.loadingSubtitle}>Building your personalized deep dive</Text>
      </View>
    );
  }

  if (stage === 'thinking') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.teal} />
        <Text style={styles.loadingTitle}>Finding your perfect pedal…</Text>
        <Text style={styles.loadingSubtitle}>Reviewing everything you've told us</Text>
      </View>
    );
  }

  if (stage === 'regenerating') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.teal} />
        <Text style={styles.loadingTitle}>Finding a better match…</Text>
        <Text style={styles.loadingSubtitle}>Using your feedback to dig deeper</Text>
      </View>
    );
  }

  // Onboarding — delegates entirely to PlayerOnboarding
  if (stage === 'onboarding') {
    return (
      <PlayerOnboarding
        onComplete={async (fullProfile) => {
          await saveProfile(fullProfile);
          setProfile(fullProfile);
          setHasExistingProfile(true);
          runAnalysis(fullProfile);
        }}
        onDismiss={onBack}
        initialAnswers={profile ?? undefined}
      />
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Back button */}
      <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
        <Text style={styles.backBtnText}>Back</Text>
      </TouchableOpacity>

      {/* ── Profile Refresh ─────────────────────────────────────────────────── */}
      {stage === 'profile_refresh' && (
        <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
          <View style={styles.refreshCard}>
            <Text style={styles.refreshEmoji}>🔄</Text>
            <Text style={styles.refreshTitle}>It's been a while</Text>
            <Text style={styles.refreshSubtitle}>
              Has anything changed in your rig or what you're chasing?
            </Text>
          </View>

          <View style={styles.refreshOptions}>
            <TouchableOpacity
              style={styles.refreshOptionBtn}
              onPress={() => {
                Haptics.selectionAsync();
                setStage('onboarding');
                fadeIn();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.refreshOptionTitle}>Update my profile</Text>
              <Text style={styles.refreshOptionSub}>Re-run relevant questions with your existing answers pre-filled</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.refreshOptionBtn}
              onPress={async () => {
                Haptics.selectionAsync();
                await updateRefreshTimer(6);
                if (profile) runAnalysis(profile, true);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.refreshOptionTitle}>Nothing's changed</Text>
              <Text style={styles.refreshOptionSub}>Reset the timer for 6 more months and continue</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.refreshOptionBtn, styles.refreshOptionBtnMuted]}
              onPress={async () => {
                Haptics.selectionAsync();
                await updateRefreshTimer(1);
                if (profile) runAnalysis(profile, true);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.refreshOptionTitle}>Remind me in 30 days</Text>
              <Text style={styles.refreshOptionSub}>Skip for now, remind me next month</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* ── Analysis / Spider Reveal ────────────────────────────────────────── */}
      {stage === 'analysis' && spiderValues && (
        <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Your Sound DNA</Text>
            {hasExistingProfile && (
              <TouchableOpacity onPress={handleResetProfile} style={styles.resetBtn}>
                <Text style={styles.resetBtnText}>Reset profile</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Analysis insight */}
          <View style={styles.analysisCard}>
            <Text style={styles.analysisText}>{analysisText}</Text>
          </View>

          {/* Spider web — the HUZZAH moment */}
          <View ref={chartRef} collapsable={false} style={styles.chartCard}>
            <Text style={styles.chartTitle}>SOUND DNA</Text>
            <SpiderChart values={spiderValues} />
            {/* Branding footer — always visible in app + captured when sharing */}
            <View style={styles.chartBrandRow}>
              <Image source={tpcLogo} style={styles.chartBrandLogo} resizeMode="contain" />
            </View>
          </View>

          {/* Share Sound DNA */}
          {spiderValues && (
            <TouchableOpacity
              style={styles.shareLink}
              onPress={() => {
                Haptics.selectionAsync();
                setChartShareOpen(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="share-social-outline" size={14} color={colors.textMuted} />
              <Text style={styles.shareLinkText}>Share your Sound DNA</Text>
            </TouchableOpacity>
          )}

          {/* CTA — now triggers the pick */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const spider = spiderValues ?? calculateSpiderValues(ownedPedals);
              setStage('thinking');
              fadeIn();
              fetchCommunitySignals(spider).then(signals => setCommunitySignal(signals));
              generateRecommendation(interviewAnswers, spider);
            }}
            activeOpacity={0.8}
          >
            <LinearGradient colors={gradients.teal} style={styles.ctaBtn}>
              <Text style={styles.ctaBtnText}>Feed Your GAS →</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Redo interview — only shown if they actually went through interview questions */}
          {interviewQuestions.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setInterviewStep(0);
                setInterviewAnswers([]);
                setStage('interview');
                fadeIn();
              }}
              style={styles.subtleBackBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.subtleBackBtnText}>← Change my answers</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}

      {/* ── Interview ──────────────────────────────────────────────────────── */}
      {stage === 'interview' && interviewQuestions.length > 0 && (
        <Animated.View style={{ opacity: fadeAnim }}>
          <View style={styles.expertHeader}>
            <Text style={styles.expertHeaderEmoji}>🎯</Text>
            <Text style={styles.expertHeaderTitle}>Let's find your pick.</Text>
            <Text style={styles.expertHeaderSub}>
              Four questions. Then we reveal your sound profile and make the call.
            </Text>
          </View>

          {/* Progress dots */}
          <View style={styles.progressRow}>
            {interviewQuestions.map((_, i) => (
              <View key={i} style={[
                styles.progressDot,
                i <= interviewStep && styles.progressDotActive,
                i < interviewStep && styles.progressDotDone,
              ]} />
            ))}
          </View>
          <Text style={styles.progressLabel}>
            {interviewStep + 1} of {interviewQuestions.length}
          </Text>

          {/* Question card */}
          <View style={styles.questionCard}>
            <Text style={styles.questionText}>
              {interviewQuestions[interviewStep]?.question}
            </Text>
          </View>

          {/* Options */}
          <View style={styles.optionsList}>
            {(interviewQuestions[interviewStep]?.options ?? []).map((opt, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.optionBtn}
                onPress={() => handleInterviewAnswer(opt)}
                activeOpacity={0.75}
              >
                <Text style={styles.optionBtnText}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {interviewStep === 0 && (
            <TouchableOpacity onPress={onBack} style={styles.subtleBackBtn} activeOpacity={0.7}>
              <Text style={styles.subtleBackBtnText}>← Cancel</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}

      {/* Off-screen share card — captured by useShareCard */}
      <HiddenShareCard cardRef={cardRef} cardData={cardData} />

      {/* Sound DNA chart share sheet */}
      <SocialShareSheet
        visible={chartShareOpen}
        onClose={() => setChartShareOpen(false)}
        text={spiderValues ? [
          'My guitar tone DNA 🕷️',
          '',
          `🔥 Drive/Dirt    ${spiderValues.drive.toFixed(1)}/10`,
          `🌊 Modulation    ${spiderValues.modulation.toFixed(1)}/10`,
          `✨ Time/Space    ${spiderValues.timeSpace.toFixed(1)}/10`,
          `⚡ Dynamics      ${spiderValues.dynamics.toFixed(1)}/10`,
          `🔄 Loopers/Multi ${spiderValues.loopersMulti.toFixed(1)}/10`,
          `🎲 Experimental  ${spiderValues.experimental.toFixed(1)}/10`,
          `🔧 Utility       ${spiderValues.utility.toFixed(1)}/10`,
          '',
          'Analyzed by The Pedal Collaborative',
          '#guitarpedals #pedalboard #tonehunter',
        ].join('\n') : ''}
        onImageShare={async () => {
          setChartShareOpen(false);
          await new Promise<void>(resolve => setTimeout(resolve, 300));
          if (chartRef.current) {
            const uri = await captureRef(chartRef, {
              format: 'png',
              quality: 1,
              result: 'tmpfile',
            });
            const Sharing = await import('expo-sharing');
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
            }
          }
        }}
      />

      {/* ── Recommendation ─────────────────────────────────────────────────── */}
      {stage === 'recommendation' && recommendation && (
        <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
          <Text style={styles.recLabel}>YOUR EXPERT PICK</Text>

          {/* Primary rec card */}
          <LinearGradient colors={['#FFFFFF', '#F2EDE7']} style={styles.recCard}>
            <View style={styles.recCardHeader}>
              <Text style={styles.recBrand}>{recommendation.brand}</Text>
              <Text style={styles.recModel}>{recommendation.model}</Text>
              <View style={styles.recPriceBadge}>
                <Text style={styles.recPrice}>{recommendation.estimatedPrice}</Text>
              </View>
            </View>

            <View style={styles.recDivider} />

            <Text style={styles.recSectionLabel}>WHY THIS PEDAL</Text>
            <Text style={styles.recWhy}>{recommendation.why}</Text>

            {recommendation.fitsRig ? (
              <>
                <Text style={[styles.recSectionLabel, { marginTop: spacing.md }]}>FITS YOUR RIG</Text>
                <Text style={styles.recDetailText}>{recommendation.fitsRig}</Text>
              </>
            ) : null}

            {recommendation.fillsGap ? (
              <>
                <Text style={[styles.recSectionLabel, { marginTop: spacing.md }]}>FILLS THE GAP</Text>
                <Text style={styles.recDetailText}>{recommendation.fillsGap}</Text>
              </>
            ) : null}

            {recommendation.boutiqueAngle ? (
              <>
                <Text style={[styles.recSectionLabel, { marginTop: spacing.md }]}>THE BOUTIQUE ANGLE</Text>
                <Text style={styles.recDetailText}>{recommendation.boutiqueAngle}</Text>
              </>
            ) : null}

            {recommendation.keyFeatures?.length > 0 && (
              <>
                <Text style={[styles.recSectionLabel, { marginTop: spacing.md }]}>KEY FEATURES</Text>
                <View style={styles.recFeatures}>
                  {recommendation.keyFeatures.map((f, i) => (
                    <View key={i} style={styles.recFeatureRow}>
                      <View style={styles.recFeatureDot} />
                      <Text style={styles.recFeatureText}>{f}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {recommendation.whereToFind ? (
              <>
                <Text style={[styles.recSectionLabel, { marginTop: spacing.md }]}>WHERE TO FIND IT</Text>
                <Text style={styles.recDetailText}>{recommendation.whereToFind}</Text>
              </>
            ) : null}
          </LinearGradient>

          {/* Action buttons */}
          <View style={styles.recActions}>
            <TouchableOpacity style={styles.wishlistBtn} onPress={handleAddToWishlist} disabled={wishlistState !== 'idle'} activeOpacity={0.8}>
              <LinearGradient colors={wishlistState === 'added' ? ['#1A8C40', '#157033'] : gradients.teal} style={styles.wishlistBtnGrad}>
                {wishlistState === 'loading' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.wishlistBtnText}>
                    {wishlistState === 'added' ? '✓ In GAS List' : '+ GAS List'}
                  </Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.reverbBtn}
              onPress={() => Linking.openURL(reverbSearchUrl(`${recommendation.brand} ${recommendation.model}`))}
              activeOpacity={0.75}
            >
              <Text style={styles.reverbBtnText}>Search on Reverb →</Text>
            </TouchableOpacity>
          </View>

          {/* Feedback */}
          {feedbackState === 'idle' && (
            <View style={styles.feedbackRow}>
              <TouchableOpacity style={styles.feedbackAcceptBtn} onPress={handleAccept} activeOpacity={0.8}>
                <Text style={styles.feedbackAcceptText}>🎯 This is it</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.feedbackRejectBtn}
                onPress={() => { Haptics.selectionAsync(); setFeedbackState('rejected_picking'); }}
                activeOpacity={0.8}
              >
                <Text style={styles.feedbackRejectText}>Not quite →</Text>
              </TouchableOpacity>
            </View>
          )}
          {feedbackState === 'rejected_picking' && (
            <View style={styles.rejectionContainer}>
              <Text style={styles.rejectionPrompt}>What was off?</Text>
              <View style={styles.rejectionChips}>
                {REJECTION_REASONS.map(reason => (
                  <TouchableOpacity
                    key={reason}
                    style={styles.rejectionChip}
                    onPress={() => handleRejectionReason(reason)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.rejectionChipText}>{reason}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          {feedbackState === 'done' && (
            <Text style={styles.feedbackDoneText}>Thanks — this helps us improve your recommendations.</Text>
          )}

          {/* Share pick */}
          <TouchableOpacity
            style={styles.sharePickBtn}
            onPress={() =>
              triggerShare({
                type: 'pick',
                brand: recommendation.brand,
                model: recommendation.model,
                why: recommendation.why,
              })
            }
            activeOpacity={0.75}
          >
            <Ionicons name="share-outline" size={16} color={colors.textMuted} />
            <Text style={styles.sharePickText}>Share this pick</Text>
          </TouchableOpacity>

          {/* Also Consider */}
          {recommendation.alsoConsider?.length > 0 && (
            <View style={styles.alsoConsiderSection}>
              <Text style={styles.alsoConsiderTitle}>ALSO CONSIDER</Text>
              {recommendation.alsoConsider.map((alt, i) => (
                <View key={i} style={styles.alsoConsiderCard}>
                  <Text style={styles.alsoConsiderName}>{alt.brand} {alt.model}</Text>
                  <Text style={styles.alsoConsiderNote}>{alt.note}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Deep Cut */}
          {recommendation.deepCut && (
            <View style={styles.deepCutCard}>
              <Text style={styles.deepCutLabel}>THE DEEP CUT</Text>
              <Text style={styles.deepCutName}>{recommendation.deepCut.brand} {recommendation.deepCut.model}</Text>
              <Text style={styles.deepCutNote}>{recommendation.deepCut.note}</Text>
              {recommendation.deepCut.whereToFind && (
                <Text style={styles.deepCutWhere}>Where to find: {recommendation.deepCut.whereToFind}</Text>
              )}
            </View>
          )}

          {/* On Your Wishlist */}
          {Boolean(recommendation.onWishlist) && (
            <View style={styles.wishlistNote}>
              <Text style={styles.wishlistNoteText}>📋 {recommendation.onWishlist}</Text>
            </View>
          )}

          {/* Secondary actions */}
          <View style={styles.recSecondaryActions}>
            <TouchableOpacity
              style={styles.tryAgainBtn}
              onPress={() => {
                setInterviewStep(0);
                setInterviewAnswers([]);
                setRecommendation(null);
                setFeedbackState('idle');
                setPreviousRecommendations([]);
                setStage('interview');
                fadeIn();
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.tryAgainText}>Try Different Answers</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tryAgainBtn}
              onPress={() => {
                setStage('analysis');
                setInterviewStep(0);
                setInterviewAnswers([]);
                setRecommendation(null);
                setFeedbackState('idle');
                setPreviousRecommendations([]);
                fadeIn();
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.tryAgainText}>← Back to Analysis</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={handleResetProfile} style={styles.resetFullBtn}>
            <Text style={styles.resetFullText}>Update my profile</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.base, paddingBottom: 60 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, minHeight: 320 },
  loadingTitle: { fontSize: typography.sizes.lg, fontFamily: typography.display, color: colors.textPrimary, textAlign: 'center', marginTop: spacing.md },
  loadingSubtitle: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textMuted, textAlign: 'center' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: spacing.xs, marginBottom: spacing.md },
  backBtnText: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textMuted },

  // Expert header (used in interview stage)
  expertHeader: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  expertHeaderEmoji: { fontSize: 44 },
  expertHeaderTitle: { fontSize: typography.sizes.xl, fontFamily: typography.display, color: colors.textPrimary },
  expertHeaderSub: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.base },

  // Progress
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.teal, width: 20 },
  progressDotDone: { backgroundColor: colors.teal + '60', width: 8 },
  progressLabel: { fontSize: typography.sizes.xs, fontFamily: typography.body, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },

  // Questions
  questionCard: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  questionText: { fontSize: typography.sizes.lg, fontFamily: typography.display, color: colors.textPrimary, textAlign: 'center', lineHeight: 28 },
  optionsList: { gap: spacing.sm, marginBottom: spacing.md },
  optionBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.base, paddingHorizontal: spacing.lg },
  optionBtnText: { flex: 1, fontSize: typography.sizes.base, fontFamily: typography.bodyMedium, color: colors.textPrimary },
  subtleBackBtn: { alignSelf: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  subtleBackBtnText: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textMuted },

  // Analysis
  section: { gap: spacing.lg },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: typography.sizes.lg, fontFamily: typography.display, color: colors.textPrimary },
  resetBtn: { paddingVertical: spacing.xs },
  resetBtnText: { fontSize: typography.sizes.xs, fontFamily: typography.body, color: colors.textMuted, textDecorationLine: 'underline' },
  analysisCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  analysisText: { fontSize: typography.sizes.base, fontFamily: typography.body, color: colors.textSecondary, lineHeight: 23 },
  chartCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingTop: spacing.lg, paddingBottom: spacing.md, paddingHorizontal: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  chartTitle: { fontSize: typography.sizes.xs, fontFamily: typography.bodySemiBold, color: colors.textMuted, letterSpacing: 1.5, textAlign: 'center' },
  chartBrandRow: { alignItems: 'center', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs },
  chartBrandLogo: { width: 140, height: 28 },
  ctaBtn: { borderRadius: radius.lg, paddingVertical: spacing.base, alignItems: 'center' },
  ctaBtnText: { fontSize: typography.sizes.base, fontFamily: typography.bodySemiBold, color: '#fff' },

  // Profile refresh
  refreshCard: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  refreshEmoji: { fontSize: 44 },
  refreshTitle: { fontSize: typography.sizes.xl, fontFamily: typography.display, color: colors.textPrimary },
  refreshSubtitle: { fontSize: typography.sizes.base, fontFamily: typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  refreshOptions: { gap: spacing.md },
  refreshOptionBtn: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  refreshOptionBtnMuted: { borderColor: colors.border, opacity: 0.7 },
  refreshOptionTitle: { fontSize: typography.sizes.base, fontFamily: typography.bodySemiBold, color: colors.textPrimary },
  refreshOptionSub: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textSecondary, lineHeight: 19 },

  // Recommendation
  recLabel: { fontSize: typography.sizes.xs, fontFamily: typography.bodySemiBold, color: colors.teal, letterSpacing: 1.5, textAlign: 'center' },
  recCard: { borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', padding: spacing.xl, gap: spacing.md },
  recCardHeader: { gap: spacing.xs },
  recBrand: { fontSize: typography.sizes.sm, fontFamily: typography.bodyMedium, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  recModel: { fontSize: typography.sizes.xxl ?? 28, fontFamily: typography.display, color: colors.textPrimary, lineHeight: 36 },
  recPriceBadge: { alignSelf: 'flex-start', backgroundColor: colors.teal + '20', borderWidth: 1, borderColor: colors.teal + '50', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  recPrice: { fontSize: typography.sizes.sm, fontFamily: typography.bodySemiBold, color: colors.teal },
  recDivider: { height: 1, backgroundColor: colors.border },
  recSectionLabel: { fontSize: typography.sizes.xs, fontFamily: typography.bodySemiBold, color: colors.textMuted, letterSpacing: 1 },
  recWhy: { fontSize: typography.sizes.base, fontFamily: typography.body, color: colors.textSecondary, lineHeight: 23 },
  recDetailText: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textSecondary, lineHeight: 20 },
  recFeatures: { gap: spacing.sm },
  recFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  recFeatureDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal, marginTop: 7 },
  recFeatureText: { flex: 1, fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textSecondary, lineHeight: 20 },
  recActions: { flexDirection: 'row', gap: spacing.md },
  wishlistBtn: { flex: 1, borderRadius: radius.lg, overflow: 'hidden' },
  wishlistBtnGrad: { paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' },
  wishlistBtnText: { fontSize: typography.sizes.sm, fontFamily: typography.bodySemiBold, color: '#fff' },
  reverbBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  reverbBtnText: { fontSize: typography.sizes.sm, fontFamily: typography.bodyMedium, color: colors.textSecondary },

  // Feedback
  feedbackRow: { flexDirection: 'row', gap: spacing.md },
  feedbackAcceptBtn: { flex: 1, backgroundColor: colors.teal + '15', borderWidth: 1, borderColor: colors.teal + '40', borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' },
  feedbackAcceptText: { fontSize: typography.sizes.base, fontFamily: typography.bodySemiBold, color: colors.teal },
  feedbackRejectBtn: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' },
  feedbackRejectText: { fontSize: typography.sizes.base, fontFamily: typography.bodyMedium, color: colors.textSecondary },
  rejectionContainer: { gap: spacing.sm },
  rejectionPrompt: { fontSize: typography.sizes.sm, fontFamily: typography.bodySemiBold, color: colors.textSecondary, textAlign: 'center' },
  rejectionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  rejectionChip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  rejectionChipText: { fontSize: typography.sizes.sm, fontFamily: typography.bodyMedium, color: colors.textSecondary },
  feedbackDoneText: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.sm },

  // Also consider
  alsoConsiderSection: { gap: spacing.sm },
  alsoConsiderTitle: { fontSize: typography.sizes.xs, fontFamily: typography.bodySemiBold, color: colors.textMuted, letterSpacing: 1 },
  alsoConsiderCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  alsoConsiderName: { fontSize: typography.sizes.base, fontFamily: typography.bodySemiBold, color: colors.textPrimary },
  alsoConsiderNote: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textSecondary, lineHeight: 20 },

  // Deep cut
  deepCutCard: { backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', padding: spacing.md, gap: spacing.xs },
  deepCutLabel: { fontSize: typography.sizes.xs, fontFamily: typography.bodySemiBold, color: colors.textMuted, letterSpacing: 1 },
  deepCutName: { fontSize: typography.sizes.base, fontFamily: typography.bodySemiBold, color: colors.textPrimary },
  deepCutNote: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textSecondary, lineHeight: 20 },
  deepCutWhere: { fontSize: typography.sizes.xs, fontFamily: typography.bodyMedium, color: colors.textMuted, fontStyle: 'italic' },

  // Wishlist note
  wishlistNote: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  wishlistNoteText: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textSecondary, lineHeight: 20 },

  // Secondary actions
  recSecondaryActions: { flexDirection: 'row', gap: spacing.md },
  tryAgainBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  tryAgainText: { fontSize: typography.sizes.xs, fontFamily: typography.bodyMedium, color: colors.textSecondary },
  resetFullBtn: { alignSelf: 'center', paddingVertical: spacing.sm },
  resetFullText: { fontSize: typography.sizes.xs, fontFamily: typography.body, color: colors.textMuted, textDecorationLine: 'underline' },

  // Share
  shareLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  shareLinkText: { fontSize: typography.sizes.xs, fontFamily: typography.bodyMedium, color: colors.textMuted },
  sharePickBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sharePickText: { fontSize: typography.sizes.sm, fontFamily: typography.bodyMedium, color: colors.textSecondary },
});
