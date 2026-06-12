import React, { useMemo, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients, boardColorMap, categoryColors } from '../theme';
import { useStore } from '../hooks/useStore';
import {
  StatCard,
  SectionHeader,
  MiniPedalCard,
  EmptyState,
  SocialShareSheet,
} from '../components';
import { SwipeDismissSheet } from '../components/SwipeDismissSheet';
import { RootStackParamList, HomeStackParamList, TabParamList } from '../types/navigation';
import { HiddenShareCard } from '../components/ShareCard';
import { useShareCard } from '../lib/useShareCard';
import { hasBetaFullAccess } from '../lib/subscription';
import { supabase, UserProfile, invokeEdgeFunction } from '../lib/supabase';
import { weeklyPickCountdownLabel } from '../lib/notifications';
import { useFormatMoney } from '../hooks/useFormatMoney';

// ─── Types ────────────────────────────────────────────────────────────────────
interface TrendingPedal {
  pedal_id: string;
  brand: string;
  model: string;
  image_url: string | null;
  category: string | null;
  week_adds: number;
}

interface LatestVideo {
  id: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
}

// ─── Milestone modal ──────────────────────────────────────────────────────────
function MilestoneModal({
  milestone,
  totalMarketValue,
  onClose,
  onGetPick,
}: {
  milestone: number;
  totalMarketValue: number;
  onClose: () => void;
  onGetPick: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { cardRef: msCardRef, cardData: msCardData, triggerShare: msTriggerShare } = useShareCard();
  const [msShareOpen, setMsShareOpen] = useState(false);
  const { fmt } = useFormatMoney();
  const emoji = milestone >= 50 ? '🏆' : milestone >= 25 ? '🎸' : milestone >= 10 ? '🎛' : '🎉';
  const label = milestone >= 50 ? "You're a serious collector."
              : milestone >= 25 ? "That's a real collection."
              : milestone >= 10 ? "Your vault is filling up."
              : "You're officially a collector.";

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={msStyles.overlay}>
        <View style={[msStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={msStyles.emoji}>{emoji}</Text>
          <Text style={msStyles.countLabel}>{milestone} PEDALS IN YOUR VAULT</Text>
          <Text style={msStyles.tagline}>{label}</Text>

          {totalMarketValue > 0 && (
            <View style={msStyles.valueRow}>
              <Text style={msStyles.valueSub}>Estimated collection value</Text>
              <Text style={msStyles.valueNum}>{fmt(totalMarketValue)}</Text>
            </View>
          )}

          <Text style={msStyles.pitch}>
            Your AI knows your rig better than ever. Ready for your next pick?
          </Text>

          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onGetPick(); }}
            activeOpacity={0.88}
            style={msStyles.ctaWrap}
          >
            <LinearGradient colors={gradients.teal} style={msStyles.cta}>
              <Text style={msStyles.ctaText}>Get My Next Pick →</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Share milestone — share the raw USD value regardless of bliss mode */}
          <TouchableOpacity
            onPress={() => { Haptics.selectionAsync(); setMsShareOpen(true); }}
            style={msStyles.shareImgBtn}
            activeOpacity={0.75}
          >
            <Ionicons name="share-social-outline" size={15} color={colors.teal} />
            <Text style={msStyles.shareImgText}>Share</Text>
          </TouchableOpacity>
          <HiddenShareCard cardRef={msCardRef} cardData={msCardData} />
          <SocialShareSheet
            visible={msShareOpen}
            onClose={() => setMsShareOpen(false)}
            text={[
              milestone >= 50 ? `I'm a serious collector now 🏆` :
              milestone >= 25 ? `That's a real collection 🎸` :
              milestone >= 10 ? `My vault is filling up 🎛` :
              `Officially a collector 🎉`,
              '',
              `${milestone} pedals in my TPC vault.`,
              totalMarketValue > 0 ? `Est. value: $${Math.round(totalMarketValue).toLocaleString()}` : null,
              '',
              `Track yours → https://thepedalcollaborative.com`,
              '',
              '#guitarpedals #pedalboard #tonehunter',
            ].filter(Boolean).join('\n')}
            xText={`${milestone} pedals in my TPC vault 🎸 #guitarpedals #pedalboard`}
            onImageShare={() => msTriggerShare({ type: 'milestone', count: milestone, marketValue: totalMarketValue })}
          />

          <TouchableOpacity onPress={onClose} style={msStyles.dismiss}>
            <Text style={msStyles.dismissText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Value Milestone modal ────────────────────────────────────────────────────
function ValueMilestoneModal({
  value,
  onClose,
}: {
  value: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { triggerShare } = useShareCard();
  const [vmShareOpen, setVmShareOpen] = useState(false);
  const { fmtCompact } = useFormatMoney();
  const fmtValue = fmtCompact(value);
  // Always use raw USD in share text (user is actively choosing to share)
  const fmtValueShare = `$${value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toLocaleString()}`;
  const emoji =
    value >= 25000 ? '💎' :
    value >= 10000 ? '🏆' :
    value >= 5000  ? '🎸' :
    '✦';
  const label =
    value >= 25000 ? "Serious tone investment." :
    value >= 10000 ? "Your vault is seriously valuable." :
    value >= 5000  ? "That's a real collection." :
    "Your gear is worth more than most realize.";

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={vmStyles.overlay}>
        <View style={[vmStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={vmStyles.emoji}>{emoji}</Text>
          <Text style={vmStyles.valueLabel}>{fmtValue} VAULT VALUE</Text>
          <Text style={vmStyles.tagline}>{label}</Text>
          <TouchableOpacity
            onPress={() => { Haptics.selectionAsync(); setVmShareOpen(true); }}
            style={msStyles.shareImgBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="share-social-outline" size={15} color={colors.teal} />
            <Text style={msStyles.shareImgText}>Share</Text>
          </TouchableOpacity>
          <SocialShareSheet
            visible={vmShareOpen}
            onClose={() => setVmShareOpen(false)}
            text={[
              `${fmtValueShare} vault value 🎛`,
              '',
              value >= 25000 ? 'Serious tone investment.' :
              value >= 10000 ? 'My vault is seriously valuable.' :
              value >= 5000  ? "That's a real collection." :
              'My gear is worth more than most realize.',
              '',
              `Track yours on TPC → https://thepedalcollaborative.com`,
              '',
              '#guitarpedals #pedalboard #tonehunter',
            ].join('\n')}
            xText={`${fmtValueShare} in pedals and counting 🎛 #guitarpedals #pedalboard`}
            onImageShare={() => triggerShare({ type: 'milestone', count: 0, marketValue: value })}
          />
          <TouchableOpacity
            onPress={() => { Haptics.selectionAsync(); onClose(); }}
            activeOpacity={0.75}
            style={vmStyles.closeBtn}
          >
            <Text style={vmStyles.closeBtnText}>Nice 🤙</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const vmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,20,25,0.78)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  emoji: {
    fontSize: 52,
    marginBottom: spacing.sm,
  },
  valueLabel: {
    fontFamily: typography.display,
    fontSize: typography.sizes.xxl,
    color: colors.teal,
    letterSpacing: 1,
    textAlign: 'center',
  },
  tagline: {
    fontFamily: typography.body,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  closeBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    backgroundColor: colors.teal + '18',
  },
  closeBtnText: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.base,
    color: colors.teal,
  },
});

// ─── Profile completion bar ───────────────────────────────────────────────────
function ProfileCompletionBar({ pct, onPress }: { pct: number; onPress: () => void }) {
  if (pct >= 100) return null;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={pcStyles.root}>
      <View style={pcStyles.textRow}>
        <Ionicons name="person-circle-outline" size={16} color={colors.teal} />
        <Text style={pcStyles.label}>
          Tone profile is <Text style={pcStyles.pct}>{pct}% complete</Text> — better picks with more info
        </Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </View>
      <View style={pcStyles.barBg}>
        <View style={[pcStyles.barFill, { width: `${pct}%` as `${number}%` }]} />
      </View>
    </TouchableOpacity>
  );
}

function calcProfilePct(profile: UserProfile | null): number {
  if (!profile?.pedal_expert_profile) return 0;
  const ep = profile.pedal_expert_profile;
  const fields = [
    ep.experience_years,
    ep.tone_identity,
    ep.guitar_heroes,
    ep.sonic_moments?.length > 0,
    ep.guitar_type,
    ep.amp_type,
    ep.signal_chain,
    ep.genres?.length > 0,
    ep.board_philosophy,
    ep.brand_attitude,
    ep.complexity_tolerance,
    ep.budget_range,
    ep.tone_chase,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}

// ─── AI Hero Card ─────────────────────────────────────────────────────────────
function AIHeroCard({
  lastPick,
  hasProfile,
  onPress,
}: {
  lastPick: { brand: string; model: string; timestamp: string } | null;
  hasProfile: boolean;
  onPress: () => void;
}) {
  const daysAgo = lastPick
    ? Math.floor((Date.now() - new Date(lastPick.timestamp).getTime()) / 86_400_000)
    : null;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88}>
      <LinearGradient colors={gradients.teal} style={heroStyles.card}>
        {/* Top row */}
        <View style={heroStyles.topRow}>
          <View style={heroStyles.badge}>
            <Text style={heroStyles.badgeText}>✦ CUSTOM SHOP</Text>
          </View>
          <Ionicons name="sparkles" size={18} color="rgba(255,255,255,0.6)" />
        </View>

        {lastPick ? (
          // Returning user — show last pick
          <>
            <Text style={heroStyles.pickLabel}>Your Last Pick</Text>
            <Text style={heroStyles.pickName} numberOfLines={1}>
              {lastPick.brand} {lastPick.model}
            </Text>
            <View style={heroStyles.bottomRow}>
              <Text style={heroStyles.pickAge}>
                {daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`}
              </Text>
              <Text style={heroStyles.runAgain}>Feed your GAS →</Text>
            </View>
          </>
        ) : (
          // First-timer
          <>
            <Text style={heroStyles.pickLabel}>Your Expert Pick</Text>
            <Text style={heroStyles.firstRunSub}>
              {hasProfile
                ? 'Tailored to your rig. 4 questions away.'
                : '4 questions. Your personalized recommendation.'}
            </Text>
            <View style={heroStyles.bottomRow}>
              <Text style={heroStyles.runAgain}>Feed your GAS →</Text>
            </View>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Value stat ───────────────────────────────────────────────────────────────
function ValueStat({ invested, market }: { invested: number; market: number }) {
  const { fmt, fmtDelta } = useFormatMoney();
  if (market <= 0) return null;
  const delta = market - invested;
  const positive = delta >= 0;
  return (
    <View style={vsStyles.root}>
      <Text style={vsStyles.num}>{fmt(Math.round(market))}</Text>
      {invested > 0 && delta !== 0 && (
        <Text style={[vsStyles.delta, { color: positive ? colors.success : colors.error }]}>
          {fmtDelta(delta)}
        </Text>
      )}
      <Text style={vsStyles.label}>Est. Value</Text>
    </View>
  );
}

// ─── This Week on TPC card ────────────────────────────────────────────────────
function ThisWeekCard({ video, onPress }: { video: LatestVideo; onPress: () => void }) {
  return (
    <TouchableOpacity style={twStyles.card} activeOpacity={0.82} onPress={onPress}>
      <View style={twStyles.thumbWrapper}>
        {video.thumbnail ? (
          <Image source={{ uri: video.thumbnail }} style={twStyles.thumb} resizeMode="cover" />
        ) : (
          <View style={[twStyles.thumb, twStyles.thumbPlaceholder]}>
            <Ionicons name="play-circle-outline" size={32} color={colors.textMuted} />
          </View>
        )}
        <View style={twStyles.playOverlay}>
          <Ionicons name="play" size={16} color="#fff" />
        </View>
      </View>
      <View style={twStyles.body}>
        <View style={twStyles.labelRow}>
          <Ionicons name="logo-youtube" size={12} color="#FF0000" />
          <Text style={twStyles.label}>THIS WEEK ON TPC</Text>
        </View>
        <Text style={twStyles.title} numberOfLines={2}>{video.title}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={twStyles.chevron} />
    </TouchableOpacity>
  );
}

// ─── HomeScreen ───────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<CompositeNavigationProp<
    NativeStackNavigationProp<HomeStackParamList>,
    CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, NativeStackNavigationProp<RootStackParamList>>
  >>();

  const {
    session,
    profile, ownedPedals, wishlistPedals, boards,
    userImageUrls, userImageThumbUrls, viewMode,
    totalInvested, totalMarketValue, marketValues,
    lastCustomShopPick,
    fetchWeeklyPick, weeklyPick,
    addToWishlist,
    milestoneToShow, clearMilestone,
    valueMilestoneToShow, clearValueMilestone,
    wifeMode,
  } = useStore();
  const { fmt, fmtDelta } = useFormatMoney();

  const [showWeeklyDetail, setShowWeeklyDetail] = useState(false);
  const [weeklyWishlistState, setWeeklyWishlistState] = useState<'idle' | 'loading' | 'added' | 'exists'>('idle');
  const [trendingPedals, setTrendingPedals] = useState<TrendingPedal[]>([]);
  const [trendingWishlistStates, setTrendingWishlistStates] = useState<Record<string, 'idle' | 'loading' | 'added' | 'exists'>>({});
  const [showVaultSnapshot, setShowVaultSnapshot] = useState(false);
  const [latestVideo, setLatestVideo] = useState<LatestVideo | null>(null);
  const isPro     = Boolean(profile?.is_premium) || hasBetaFullAccess();
  const hasProfile = Boolean(profile?.pedal_expert_profile?.onboarding_completed_at);
  const profilePct = calcProfilePct(profile);
  const recentPedals = ownedPedals.slice(0, 6);
  const [latestBoardImageUrl, setLatestBoardImageUrl] = useState<string | null>(null);

  const latestBoard = useMemo(() => {
    if (boards.length === 0) return null;
    const scored = boards.map(b => {
      const lastSlot = (b.slots ?? []).reduce((latest, slot) => {
        const ts = slot.created_at ? Date.parse(slot.created_at) : 0;
        return Math.max(latest, ts);
      }, 0);
      const boardCreated = b.created_at ? Date.parse(b.created_at) : 0;
      return { board: b, lastEdited: Math.max(boardCreated, lastSlot) };
    });
    scored.sort((a, b) => b.lastEdited - a.lastEdited);
    return scored[0]?.board ?? null;
  }, [boards]);

  const boardColorsByPedalId = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const board of boards) {
      const color = boardColorMap[board.color ?? 'teal'] ?? colors.teal;
      for (const slot of board.slots ?? []) {
        if (!slot.pedal_id) continue;
        const list = map[slot.pedal_id] ?? [];
        if (!list.includes(color)) list.push(color);
        map[slot.pedal_id] = list;
      }
    }
    return map;
  }, [boards]);

  // Vault value breakdown by category
  const categoryBreakdown = useMemo(() => {
    if (ownedPedals.length === 0) return [];
    const map: Record<string, { count: number; invested: number; market: number }> = {};
    for (const p of ownedPedals) {
      const cat = p.category_override ?? p.pedal?.category ?? 'other';
      if (!map[cat]) map[cat] = { count: 0, invested: 0, market: 0 };
      map[cat].count++;
      if (p.purchase_price) map[cat].invested += p.purchase_price;
      if (marketValues[p.pedal_id]) map[cat].market += marketValues[p.pedal_id];
    }
    return Object.entries(map)
      .map(([cat, data]) => ({ cat, ...data }))
      .sort((a, b) => (b.market || b.invested) - (a.market || a.invested));
  }, [ownedPedals, marketValues]);

  // Board category dots for home card
  const boardSlotColors = useMemo(() => {
    if (!latestBoard) return [];
    return (latestBoard.slots ?? []).slice(0, 7).map(slot => {
      return categoryColors[slot.pedal?.category ?? ''] ?? colors.textMuted;
    });
  }, [latestBoard]);

  useEffect(() => {
    if (!isPro) return;
    fetchWeeklyPick();
  }, [isPro, fetchWeeklyPick]);

  useEffect(() => {
    let mounted = true;
    const loadBoardPreview = async () => {
      if (!latestBoard?.board_image_path) {
        if (mounted) setLatestBoardImageUrl(null);
        return;
      }
      const { data } = await supabase.storage
        .from('user-pedal-photos')
        .createSignedUrl(latestBoard.board_image_path, 60 * 60 * 24 * 7);
      if (mounted) setLatestBoardImageUrl(data?.signedUrl ?? null);
    };
    loadBoardPreview();
    return () => {
      mounted = false;
    };
  }, [latestBoard?.id, latestBoard?.board_image_path]);

  useEffect(() => {
    let mounted = true;
    invokeEdgeFunction('youtube-videos', {}).then(({ data }) => {
      if (!mounted) return;
      const v = (data as { videos?: LatestVideo[] })?.videos?.[0];
      if (v) setLatestVideo(v);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    void supabase.rpc('get_trending_pedals', { limit_count: 5 }).then(({ data }) => {
      if (!mounted || !data) return;
      setTrendingPedals(data as TrendingPedal[]);
    });
    return () => { mounted = false; };
  }, [session]);

  const navigateToFinder = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Switch to the TPC.ai tab so the Custom Shop experience is consistent
    // with the bottom bar entry point (both land on AIHub)
    navigation.getParent()?.navigate('TPC.ai' as never);
  };

  const navigateToProfile = () => {
    Haptics.selectionAsync();
    // HomeStack -> TabNavigator -> RootStack
    navigation.getParent()?.getParent()?.navigate('Profile' as never);
  };

  const displayName = profile?.display_name
    ?? profile?.username
    ?? 'Guitarist';
  const initials = displayName[0]?.toUpperCase() ?? '?';
  const userMeta = session?.user?.user_metadata as Record<string, unknown> | undefined;
  const profileImageUrl =
    (typeof userMeta?.avatar_url === 'string' && userMeta.avatar_url) ||
    (typeof userMeta?.picture === 'string' && userMeta.picture) ||
    (typeof userMeta?.photo_url === 'string' && userMeta.photo_url) ||
    null;

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: 8 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <LinearGradient
          colors={gradients.header}
          style={[styles.header, { paddingTop: insets.top + 10 }]}
        >
          <View style={styles.headerRow}>
            <Image
              source={require('../../assets/splash-icon.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            {/* Profile avatar — replaces settings gear */}
            <TouchableOpacity
              style={styles.avatarBtn}
              onPress={navigateToProfile}
              activeOpacity={0.75}
            >
              <LinearGradient colors={gradients.teal} style={styles.avatar}>
                {profileImageUrl ? (
                  <Image
                    source={{ uri: profileImageUrl }}
                    style={styles.avatarImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
              </LinearGradient>
              {isPro && (
                <View style={styles.proDot}>
                  <Text style={styles.proDotText}>✦</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Stats row — Owned / Wishlist / Boards */}
          <View style={styles.statsRow}>
            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.statTile}
              onPress={() => navigation.navigate('Vault', { initialTab: 'owned' })}
            >
              <StatCard label="Owned" value={ownedPedals.length} accent={colors.teal} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.statTile}
              onPress={() => navigation.navigate('Vault', { initialTab: 'wishlist' })}
            >
              <StatCard label="GAS List" value={wishlistPedals.length} accent={colors.rose} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.statTile}
              onPress={() => navigation.navigate('Boards' as never)}
            >
              <StatCard label="Boards" value={boards.length} accent={colors.slate} />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <View style={styles.body}>

          {/* ── Vault Snapshot ── */}
          {ownedPedals.length > 0 && !wifeMode && (
            <TouchableOpacity
              style={styles.vaultSnapshot}
              activeOpacity={0.85}
              onPress={() => setShowVaultSnapshot(true)}
            >
              <View style={styles.vaultSnapshotHeader}>
                <Ionicons name="trending-up-outline" size={13} color={colors.teal} />
                <Text style={styles.vaultSnapshotTitle}>Vault Value</Text>
                <Ionicons name="chevron-forward" size={13} color={colors.textMuted} />
              </View>
              {totalMarketValue > 0 ? (
                <View style={styles.vaultSnapshotRow}>
                  <View style={styles.vaultSnapshotStat}>
                    <Text style={styles.vaultSnapshotStatValue}>{fmt(totalInvested)}</Text>
                    <Text style={styles.vaultSnapshotStatLabel}>Invested</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={13} color={colors.textMuted} />
                  <View style={styles.vaultSnapshotStat}>
                    <Text style={[styles.vaultSnapshotStatValue, { color: colors.teal }]}>{fmt(totalMarketValue)}</Text>
                    <Text style={styles.vaultSnapshotStatLabel}>Market</Text>
                  </View>
                  {totalInvested > 0 && (
                    <View style={[styles.vaultSnapshotBadge, {
                      backgroundColor: totalMarketValue >= totalInvested ? colors.teal + '20' : colors.rose + '20',
                    }]}>
                      <Text style={[styles.vaultSnapshotBadgeText, {
                        color: totalMarketValue >= totalInvested ? colors.teal : colors.rose,
                      }]}>
                        {fmtDelta(totalMarketValue - totalInvested)}
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <Text style={styles.vaultSnapshotEmpty}>
                  {ownedPedals.length} pedal{ownedPedals.length !== 1 ? 's' : ''} · Tap to see breakdown
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* ── Profile completion nudge ── */}
          <ProfileCompletionBar
            pct={profilePct}
            onPress={navigateToProfile}
          />

          {/* ── AI Hero Card ── (most important element, always first) */}
          <AIHeroCard
            lastPick={lastCustomShopPick}
            hasProfile={hasProfile}
            onPress={navigateToFinder}
          />

          {/* ── Weekly Pick card (Pro only) ── */}
          {isPro && weeklyPick && (
            <TouchableOpacity
              style={styles.weeklyCard}
              activeOpacity={0.8}
              onPress={() => { setWeeklyWishlistState('idle'); setShowWeeklyDetail(true); }}
            >
              <View style={styles.weeklyCardHeader}>
                <Ionicons name="sparkles" size={13} color={colors.gold} />
                <Text style={styles.weeklyCardLabel}>This Week's Pick</Text>
                <Ionicons name="chevron-forward" size={13} color={colors.gold} />
              </View>
              <Text style={styles.weeklyCardPedal}>{weeklyPick.brand} {weeklyPick.model}</Text>
              <Text style={styles.weeklyCardWhy} numberOfLines={2}>{weeklyPick.why}</Text>
              <Text style={styles.weeklyCardCountdown}>{weeklyPickCountdownLabel()}</Text>
            </TouchableOpacity>
          )}

          {/* ── Trending in the Community ── */}
          {trendingPedals.length > 0 && (
            <View style={styles.trendingSection}>
              <View style={styles.trendingHeader}>
                <Ionicons name="flame-outline" size={14} color={colors.rose} />
                <Text style={styles.trendingHeaderText}>TRENDING THIS WEEK</Text>
              </View>
              {trendingPedals.map((pedal) => {
                const wishState = trendingWishlistStates[pedal.pedal_id] ?? 'idle';
                return (
                  <View key={pedal.pedal_id} style={styles.trendingRow}>
                    {pedal.image_url ? (
                      <Image source={{ uri: pedal.image_url }} style={styles.trendingThumb} resizeMode="contain" />
                    ) : (
                      <View style={[styles.trendingThumb, styles.trendingThumbPlaceholder]}>
                        <Ionicons name="hardware-chip-outline" size={18} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={styles.trendingInfo}>
                      <Text style={styles.trendingPedalName} numberOfLines={1}>
                        {pedal.brand} {pedal.model}
                      </Text>
                      <Text style={styles.trendingCount}>
                        {pedal.week_adds} member{pedal.week_adds === 1 ? '' : 's'} added this
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.trendingWishlistBtn,
                        wishState !== 'idle' && styles.trendingWishlistBtnDone,
                      ]}
                      activeOpacity={0.75}
                      disabled={wishState !== 'idle'}
                      onPress={async () => {
                        Haptics.selectionAsync();
                        setTrendingWishlistStates(prev => ({ ...prev, [pedal.pedal_id]: 'loading' }));
                        const result = await addToWishlist(pedal.brand, pedal.model, {
                          category: pedal.category ?? 'other',
                          subcategory: 'Trending',
                          description: '',
                          analog: false,
                          price: null,
                        });
                        setTrendingWishlistStates(prev => ({
                          ...prev,
                          [pedal.pedal_id]: result === 'added' ? 'added' : result === 'exists' ? 'exists' : 'idle',
                        }));
                      }}
                    >
                      {wishState === 'loading' ? (
                        <ActivityIndicator size="small" color={colors.teal} />
                      ) : wishState === 'added' ? (
                        <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
                      ) : wishState === 'exists' ? (
                        <Ionicons name="checkmark-circle" size={20} color={colors.textMuted} />
                      ) : (
                        <Ionicons name="add-circle-outline" size={20} color={colors.teal} />
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── This Week on TPC ── */}
          {latestVideo && (
            <ThisWeekCard
              video={latestVideo}
              onPress={() => {
                Haptics.selectionAsync();
                navigation.navigate('Videos' as never);
              }}
            />
          )}

          {/* ── Recent Pedals ── */}
          <View style={styles.section}>
            <SectionHeader
              title="Recent Additions"
              action={ownedPedals.length > 0 ? 'See All' : undefined}
              onAction={() => navigation.navigate('Vault', { initialTab: 'owned' })}
            />
            {recentPedals.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {recentPedals.map(p => (
                  <MiniPedalCard
                    key={p.id}
                    userPedal={p}
                    imageUrlOverride={userImageThumbUrls[p.id] ?? userImageUrls[p.id]}
                    viewMode={viewMode}
                    boardColors={boardColorsByPedalId[p.pedal_id]}
                    onPress={() =>
                      navigation.navigate('Vault', { initialTab: 'owned', openPedalId: p.id })
                    }
                  />
                ))}
              </ScrollView>
            ) : (
              <EmptyState
                icon="musical-notes-outline"
                title="No pedals yet"
                subtitle="Add your first pedal to start building your vault"
                compact
              />
            )}
          </View>

          {/* ── Current Board ── (richer card with category dots) */}
          <View style={styles.section}>
            <SectionHeader title="Current Board" />
            {latestBoard ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  navigation.navigate('Boards' as never);
                }}
              >
                <View style={styles.boardCard}>
                  <LinearGradient colors={gradients.slate} style={styles.boardCardHeader}>
                    {latestBoardImageUrl ? (
                      <>
                        <Image source={{ uri: latestBoardImageUrl }} style={styles.boardCardImage} resizeMode="cover" />
                        <View style={styles.boardCardImageOverlay} />
                      </>
                    ) : null}
                    <View style={styles.boardDotRow}>
                      <View style={[styles.boardColorDot, {
                        backgroundColor: boardColorMap[latestBoard.color ?? 'teal'] ?? colors.teal,
                      }]} />
                      {boardSlotColors.map((c, i) => (
                        <View key={i} style={[styles.categoryDot, { backgroundColor: c }]} />
                      ))}
                      {(latestBoard.slots?.length ?? 0) > 7 && (
                        <Text style={styles.moreText}>+{(latestBoard.slots?.length ?? 0) - 7}</Text>
                      )}
                    </View>
                  </LinearGradient>
                  <View style={styles.boardCardBody}>
                    <View style={styles.boardCardInfo}>
                      <Text style={styles.boardCardName} numberOfLines={1}>
                        {latestBoard.name}
                      </Text>
                      <Text style={styles.boardCardCount}>
                        {(latestBoard.slots?.length ?? 0)} pedal{(latestBoard.slots?.length ?? 0) !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </View>
                </View>
              </TouchableOpacity>
            ) : (
              <EmptyState
                icon="grid-outline"
                title="No boards yet"
                subtitle="Create a board to organize your signal chain"
                compact
              />
            )}
          </View>


        </View>
      </ScrollView>

      {/* ── Weekly Pick detail sheet ── */}
      {weeklyPick && (
        <Modal
          visible={showWeeklyDetail}
          transparent
          animationType="slide"
          onRequestClose={() => setShowWeeklyDetail(false)}
        >
          <View style={styles.weeklyModalOverlay}>
            <TouchableOpacity style={styles.weeklyModalBackdrop} activeOpacity={1} onPress={() => setShowWeeklyDetail(false)} />
            <SwipeDismissSheet style={styles.weeklyModalSheet} onDismiss={() => setShowWeeklyDetail(false)}>
              <TouchableOpacity onPress={() => setShowWeeklyDetail(false)} activeOpacity={0.7} style={styles.sheetCloseBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
              {/* Header */}
              <View style={styles.weeklyModalHeader}>
                <View style={styles.weeklyModalTitleRow}>
                  <Ionicons name="sparkles" size={15} color={colors.gold} />
                  <Text style={styles.weeklyModalTitle}>This Week's Pick</Text>
                </View>
              </View>

              {/* Pedal name */}
              <Text style={styles.weeklyModalPedal}>{weeklyPick.brand} {weeklyPick.model}</Text>
              <View style={styles.weeklyModalMeta}>
                {weeklyPick.category && (
                  <Text style={styles.weeklyModalCategory}>{weeklyPick.category}</Text>
                )}
                {weeklyPick.isTpcVideo && (
                  <View style={styles.tpcBadge}>
                    <Ionicons name="logo-youtube" size={11} color="#FF0000" />
                    <Text style={styles.tpcBadgeText}>TPC Video</Text>
                  </View>
                )}
              </View>

              {/* Embedded video */}
              {weeklyPick.videoId && (
                <View style={styles.weeklyVideoWrapper}>
                  <WebView
                    style={styles.weeklyVideo}
                    source={{ uri: `https://www.youtube.com/embed/${weeklyPick.videoId}?playsinline=1&rel=0&modestbranding=1` }}
                    allowsInlineMediaPlayback
                    mediaPlaybackRequiresUserAction={false}
                    scrollEnabled={false}
                  />
                </View>
              )}

              {/* Why */}
              <Text style={styles.weeklyModalWhyLabel}>Why this pedal?</Text>
              <Text style={styles.weeklyModalWhy}>{weeklyPick.why}</Text>

              {/* Actions */}
              <View style={styles.weeklyModalActions}>
                <TouchableOpacity
                  style={[styles.weeklyModalBtnWishlist, weeklyWishlistState !== 'idle' && styles.weeklyModalBtnWishlistDone]}
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
                      <Text style={styles.weeklyModalBtnWishlistText}>Added to Wishlist</Text>
                    </>
                  ) : weeklyWishlistState === 'exists' ? (
                    <>
                      <Ionicons name="checkmark-circle" size={16} color={colors.textMuted} />
                      <Text style={[styles.weeklyModalBtnWishlistText, { color: colors.textMuted }]}>Already on Wishlist</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="bookmark-outline" size={16} color={colors.teal} />
                      <Text style={styles.weeklyModalBtnWishlistText}>Add to Wishlist</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </SwipeDismissSheet>
          </View>
        </Modal>
      )}

      {/* ── Vault Snapshot modal ── */}
      <Modal
        visible={showVaultSnapshot}
        transparent
        animationType="slide"
        onRequestClose={() => setShowVaultSnapshot(false)}
      >
        <View style={styles.weeklyModalOverlay}>
          <TouchableOpacity style={styles.weeklyModalBackdrop} activeOpacity={1} onPress={() => setShowVaultSnapshot(false)} />
          <SwipeDismissSheet style={[styles.weeklyModalSheet, { maxHeight: '80%' }]} onDismiss={() => setShowVaultSnapshot(false)}>
            <TouchableOpacity onPress={() => setShowVaultSnapshot(false)} activeOpacity={0.7} style={styles.sheetCloseBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.weeklyModalHeader}>
              <View style={styles.weeklyModalTitleRow}>
                <Ionicons name="trending-up-outline" size={15} color={colors.teal} />
                <Text style={styles.weeklyModalTitle}>Vault Snapshot</Text>
              </View>
            </View>

            {/* Totals */}
            {totalMarketValue > 0 && totalInvested > 0 && (
              <View style={styles.snapshotTotals}>
                <View style={styles.snapshotTotalItem}>
                  <Text style={styles.snapshotTotalValue}>{fmt(totalInvested)}</Text>
                  <Text style={styles.snapshotTotalLabel}>Invested</Text>
                </View>
                <View style={styles.snapshotTotalItem}>
                  <Text style={[styles.snapshotTotalValue, { color: colors.teal }]}>{fmt(totalMarketValue)}</Text>
                  <Text style={styles.snapshotTotalLabel}>Market Value</Text>
                </View>
                <View style={styles.snapshotTotalItem}>
                  <Text style={[styles.snapshotTotalValue, {
                    color: totalMarketValue >= totalInvested ? colors.teal : colors.rose,
                  }]}>
                    {fmtDelta(totalMarketValue - totalInvested)}
                  </Text>
                  <Text style={styles.snapshotTotalLabel}>Net</Text>
                </View>
              </View>
            )}

            <ScrollView contentContainerStyle={styles.snapshotList}>
              <Text style={styles.weeklyModalWhyLabel}>By Category</Text>
              {categoryBreakdown.map(({ cat, count, invested, market }) => {
                const dotColor = categoryColors[cat] ?? colors.textMuted;
                const net = market > 0 && invested > 0 ? market - invested : null;
                const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');
                return (
                  <View key={cat} style={styles.snapshotCatRow}>
                    <View style={[styles.snapshotCatDot, { backgroundColor: dotColor }]} />
                    <View style={styles.snapshotCatInfo}>
                      <Text style={styles.snapshotCatName}>
                        {label}{' '}
                        <Text style={styles.snapshotCatCount}>({count})</Text>
                      </Text>
                      <Text style={styles.snapshotCatSub}>
                        {market > 0
                          ? `${fmt(market)} market`
                          : invested > 0
                          ? `${fmt(invested)} invested`
                          : `${count} pedal${count !== 1 ? 's' : ''}`}
                      </Text>
                    </View>
                    {net !== null && (
                      <Text style={[styles.snapshotCatNet, { color: net >= 0 ? colors.teal : colors.rose }]}>
                        {fmtDelta(net)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </SwipeDismissSheet>
        </View>
      </Modal>

      {/* ── Milestone celebration ── */}
      {milestoneToShow !== null && (
        <MilestoneModal
          milestone={milestoneToShow}
          totalMarketValue={totalMarketValue}
          onClose={() => { clearMilestone(); }}
          onGetPick={() => { clearMilestone(); navigateToFinder(); }}
        />
      )}

      {/* ── Value milestone celebration ── */}
      {valueMilestoneToShow !== null && milestoneToShow === null && (
        <ValueMilestoneModal
          value={valueMilestoneToShow}
          onClose={clearValueMilestone}
        />
      )}
    </>
  );
}

// ─── Sub-component styles ─────────────────────────────────────────────────────

const heroStyles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    padding: spacing.base,
    gap: spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
    letterSpacing: 1,
  },
  pickLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: 'rgba(255,255,255,0.7)',
  },
  pickName: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: '#fff',
    lineHeight: 28,
  },
  firstRunSub: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 20,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  pickAge: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.55)',
  },
  runAgain: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
});

const vsStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  num: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  delta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
  },
  label: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
});

const pcStyles = StyleSheet.create({
  root: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  pct: {
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  barBg: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.teal,
    borderRadius: radius.full,
  },
});

const msStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emoji: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  countLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    letterSpacing: 1,
  },
  tagline: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  valueRow: {
    alignItems: 'center',
    gap: 2,
    marginVertical: spacing.sm,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    width: '100%',
  },
  valueSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  valueNum: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: colors.success,
  },
  pitch: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  ctaWrap: { width: '100%' },
  cta: {
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: '#fff',
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  shareImgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  shareImgText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
  },
  shareText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  dismiss: { paddingVertical: spacing.sm },
  dismissText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    // scrollable — no paddingBottom here, handled inline
  },
  header: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoImage: {
    width: 160,
    height: 45,
  },
  avatarBtn: {
    position: 'relative',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 16,
    fontFamily: typography.display,
    color: '#fff',
  },
  proDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  proDotText: {
    fontSize: 7,
    color: '#1A1A1A',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statTile: {
    flex: 1,
  },
  body: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  // Weekly Pick card
  trendingSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  trendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  trendingHeaderText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.rose,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  trendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  trendingThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHigh,
  },
  trendingThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendingInfo: {
    flex: 1,
    gap: 2,
  },
  trendingPedalName: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  trendingCount: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  trendingWishlistBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendingWishlistBtnDone: {
    opacity: 0.7,
  },
  weeklyCard: {
    backgroundColor: 'rgba(212,175,55,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.22)',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  weeklyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  weeklyCardLabel: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.gold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  weeklyCardPedal: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  weeklyCardWhy: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  weeklyCardCountdown: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.gold,
    opacity: 0.8,
    marginTop: 2,
  },
  // Weekly Pick modal
  weeklyModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  weeklyModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  weeklyModalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  weeklyModalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  sheetCloseBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 10,
    padding: spacing.xs,
  },
  weeklyModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xl, // leave room for absolute X
  },
  weeklyModalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  weeklyModalTitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.gold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  weeklyModalPedal: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: colors.textPrimary,
    lineHeight: 32,
  },
  weeklyModalCategory: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: -spacing.xs,
  },
  weeklyModalWhyLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  weeklyModalWhy: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  weeklyModalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  weeklyModalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tpcBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,0,0,0.08)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  tpcBadgeText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: '#CC0000',
  },
  weeklyVideoWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: spacing.md,
  },
  weeklyVideo: {
    flex: 1,
  },
  weeklyModalBtnWishlist: {
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
  weeklyModalBtnWishlistDone: {
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  weeklyModalBtnWishlistText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  section: {
    gap: spacing.xs,
  },
  horizontalList: {
    paddingBottom: spacing.xs,
    paddingRight: spacing.base,
  },
  // Board card
  boardCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  boardCardHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'relative',
    overflow: 'hidden',
  },
  boardCardImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  boardCardImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,28,36,0.4)',
  },
  boardDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  boardColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 2,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  moreText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.6)',
  },
  boardCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  boardCardInfo: {
    flex: 1,
    gap: 2,
  },
  boardCardName: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  boardCardCount: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  // Add pedal (secondary action)
  addPedalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.teal,
    borderRadius: radius.xl,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(45,138,126,0.06)',
  },
  addPedalText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },

  // ── Vault Snapshot card ───────────────────────────────────────────────────
  vaultSnapshot: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  vaultSnapshotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  vaultSnapshotTitle: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  vaultSnapshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  vaultSnapshotStat: {
    alignItems: 'flex-start',
  },
  vaultSnapshotStatValue: {
    fontSize: typography.sizes.md,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  vaultSnapshotStatLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  vaultSnapshotBadge: {
    marginLeft: 'auto' as any,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  vaultSnapshotBadgeText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
  },
  vaultSnapshotEmpty: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },

  // ── Vault Snapshot modal ──────────────────────────────────────────────────
  snapshotTotals: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  snapshotTotalItem: {
    alignItems: 'center',
    gap: 2,
  },
  snapshotTotalValue: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  snapshotTotalLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  snapshotList: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  snapshotCatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '60',
  },
  snapshotCatDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  snapshotCatInfo: {
    flex: 1,
    gap: 2,
  },
  snapshotCatName: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  snapshotCatCount: {
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  snapshotCatSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  snapshotCatNet: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
  },
});

const THUMB_W = 80;
const THUMB_H = 54;

const twStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  thumbWrapper: {
    position: 'relative',
    width: THUMB_W,
    height: THUMB_H,
    flexShrink: 0,
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    backgroundColor: colors.surfaceHigh,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingVertical: spacing.sm,
    gap: 3,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    fontFamily: typography.bodySemiBold,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.sm,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  chevron: {
    flexShrink: 0,
  },
});
