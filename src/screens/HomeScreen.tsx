import React, { useMemo, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  Linking,
  ActivityIndicator,
} from 'react-native';
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
} from '../components';
import { RootStackParamList, HomeStackParamList, TabParamList } from '../types/navigation';
import { shareVaultMilestone } from '../lib/share';
import { HiddenShareCard } from '../components/ShareCard';
import { useShareCard } from '../lib/useShareCard';
import { hasBetaFullAccess } from '../lib/subscription';
import { supabase, UserProfile } from '../lib/supabase';
import { reverbSearchUrl } from '../lib/reverb';
import { weeklyPickCountdownLabel } from '../lib/notifications';

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
              <Text style={msStyles.valueNum}>${totalMarketValue.toLocaleString()}</Text>
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

          {/* Share milestone — image card (Instagram/TikTok) + text fallback */}
          <View style={msStyles.shareRow}>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                msTriggerShare({ type: 'milestone', count: milestone, marketValue: totalMarketValue });
              }}
              style={msStyles.shareImgBtn}
              activeOpacity={0.75}
            >
              <Ionicons name="share-social-outline" size={15} color={colors.teal} />
              <Text style={msStyles.shareImgText}>Share as Image</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.selectionAsync(); shareVaultMilestone(milestone, totalMarketValue); }}
              style={msStyles.shareBtn}
              activeOpacity={0.75}
            >
              <Ionicons name="share-outline" size={14} color={colors.textMuted} />
              <Text style={msStyles.shareText}>Text</Text>
            </TouchableOpacity>
          </View>
          <HiddenShareCard cardRef={msCardRef} cardData={msCardData} />

          <TouchableOpacity onPress={onClose} style={msStyles.dismiss}>
            <Text style={msStyles.dismissText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

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
              <Text style={heroStyles.runAgain}>Run again →</Text>
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
              <Text style={heroStyles.runAgain}>Get My Pick →</Text>
            </View>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Value stat ───────────────────────────────────────────────────────────────
function ValueStat({ invested, market }: { invested: number; market: number }) {
  if (market <= 0) return null;
  const delta = market - invested;
  const positive = delta >= 0;
  const label = positive ? `+$${Math.round(delta).toLocaleString()}` : `-$${Math.abs(Math.round(delta)).toLocaleString()}`;
  return (
    <View style={vsStyles.root}>
      <Text style={vsStyles.num}>${Math.round(market).toLocaleString()}</Text>
      {invested > 0 && delta !== 0 && (
        <Text style={[vsStyles.delta, { color: positive ? colors.success : colors.error }]}>
          {label}
        </Text>
      )}
      <Text style={vsStyles.label}>Est. Value</Text>
    </View>
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
    totalInvested, totalMarketValue,
    lastCustomShopPick,
    fetchWeeklyPick, weeklyPick,
    addToWishlist,
    milestoneToShow, clearMilestone,
  } = useStore();

  const [showWeeklyDetail, setShowWeeklyDetail] = useState(false);
  const [weeklyWishlistState, setWeeklyWishlistState] = useState<'idle' | 'loading' | 'added' | 'exists'>('idle');
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

  const navigateToFinder = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('Finder' as never);
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

          {/* Stats row — Owned / Wishlist / Est. Value */}
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
              <StatCard label="Wishlist" value={wishlistPedals.length} accent={colors.rose} />
            </TouchableOpacity>
            {/* Value stat — shows market value delta when data is available */}
            {totalMarketValue > 0 ? (
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.statTile}
                onPress={() => navigation.navigate('Vault', { initialTab: 'owned' })}
              >
                <ValueStat invested={totalInvested} market={totalMarketValue} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.statTile}
                onPress={() => navigation.navigate('Boards' as never)}
              >
                <StatCard label="Boards" value={boards.length} accent={colors.slate} />
              </TouchableOpacity>
            )}
          </View>
        </LinearGradient>

        <View style={styles.body}>

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

          {/* ── Quick Action: Add Pedal (secondary — primary is the AI card above) ── */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              navigation.navigate('Vault', { initialTab: 'owned', openAddModal: true });
            }}
            style={styles.addPedalBtn}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.teal} />
            <Text style={styles.addPedalText}>Add a Pedal</Text>
          </TouchableOpacity>

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
            <View style={styles.weeklyModalSheet}>
              <View style={styles.weeklyModalHandle} />
              {/* Header */}
              <View style={styles.weeklyModalHeader}>
                <View style={styles.weeklyModalTitleRow}>
                  <Ionicons name="sparkles" size={15} color={colors.gold} />
                  <Text style={styles.weeklyModalTitle}>This Week's Pick</Text>
                </View>
                <TouchableOpacity onPress={() => setShowWeeklyDetail(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <Ionicons name="close" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Pedal name */}
              <Text style={styles.weeklyModalPedal}>{weeklyPick.brand} {weeklyPick.model}</Text>
              {weeklyPick.category && (
                <Text style={styles.weeklyModalCategory}>{weeklyPick.category}</Text>
              )}

              {/* Why */}
              <Text style={styles.weeklyModalWhyLabel}>Why this pedal?</Text>
              <Text style={styles.weeklyModalWhy}>{weeklyPick.why}</Text>

              {/* Actions */}
              <View style={styles.weeklyModalActions}>
                <TouchableOpacity
                  style={styles.weeklyModalBtnReverb}
                  activeOpacity={0.8}
                  onPress={() => Linking.openURL(reverbSearchUrl(`${weeklyPick.brand} ${weeklyPick.model}`))}
                >
                  <Ionicons name="storefront-outline" size={16} color="#fff" />
                  <Text style={styles.weeklyModalBtnReverbText}>See on Reverb</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.weeklyModalBtnWishlist, weeklyWishlistState !== 'idle' && styles.weeklyModalBtnWishlistDone]}
                  activeOpacity={0.8}
                  disabled={weeklyWishlistState !== 'idle'}
                  onPress={async () => {
                    setWeeklyWishlistState('loading');
                    const result = await addToWishlist(weeklyPick.brand, weeklyPick.model);
                    setWeeklyWishlistState(result === 'exists' ? 'exists' : 'added');
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
            </View>
          </View>
        </Modal>
      )}

      {/* ── Milestone celebration ── */}
      {milestoneToShow !== null && (
        <MilestoneModal
          milestone={milestoneToShow}
          totalMarketValue={totalMarketValue}
          onClose={() => { clearMilestone(); }}
          onGetPick={() => { clearMilestone(); navigateToFinder(); }}
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
  weeklyModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  weeklyModalBtnReverb: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#E25B45',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  weeklyModalBtnReverbText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
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
});
