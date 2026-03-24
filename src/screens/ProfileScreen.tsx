import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';
import { useStore } from '../hooks/useStore';
import { supabase, FullExpertProfile } from '../lib/supabase';
import { ToneProfileEditor } from '../components';
import { StatCard, TPCLogoMark } from '../components';
import { shareProfile } from '../lib/share';
import { HiddenShareCard } from '../components/ShareCard';
import { useShareCard } from '../lib/useShareCard';
import { hasBetaFullAccess } from '../lib/subscription';

const tpcSquare = require('../../assets/tpc-square.png');

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { session, profile, ownedPedals, wishlistPedals, boards, fetchProfile, signOut, viewMode, setViewMode, openPaywall } =
    useStore();

  const { cardRef: rigCardRef, cardData: rigCardData, triggerShare: triggerRigShare } = useShareCard();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.display_name ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [showToneEditor, setShowToneEditor] = useState(false);
  const isPro = Boolean(profile?.is_premium) || hasBetaFullAccess();

  const handleManageSubscription = async () => {
    const url =
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions';
    Haptics.selectionAsync();
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Unavailable', 'Unable to open subscription management on this device.');
    }
  };

  const handleSubscriptionPress = async () => {
    if (isPro) {
      await handleManageSubscription();
      return;
    }
    Haptics.selectionAsync();
    openPaywall('general');
  };

  const handleSaveName = async () => {
    if (!session || !nameInput.trim()) return;
    setIsSaving(true);
    await supabase
      .from('user_profiles')
      .update({ display_name: nameInput.trim() })
      .eq('id', session.user.id);
    await fetchProfile();
    setIsSaving(false);
    setEditingName(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  const handleToneProfileSave = async (updated: FullExpertProfile) => {
    if (!session) return;
    await supabase
      .from('user_profiles')
      .update({ pedal_expert_profile: updated })
      .eq('id', session.user.id);
    await fetchProfile();
    setShowToneEditor(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const displayName = profile?.display_name ?? session?.user.email?.split('@')[0] ?? 'Guitarist';
  const initials = displayName[0]?.toUpperCase() ?? '?';
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <>
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ── */}
      <LinearGradient colors={gradients.header} style={styles.header}>
        {navigation.canGoBack() ? (
          <TouchableOpacity
            onPress={() => {
              Haptics.selectionAsync();
              navigation.goBack();
            }}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.headerTitle}>Profile</Text>
      </LinearGradient>

      {/* ── Avatar & Identity ── */}
      <View style={styles.identitySection}>
        <LinearGradient colors={gradients.teal} style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </LinearGradient>

        {editingName ? (
          <View style={styles.nameEditRow}>
            <TextInput
              style={styles.nameInput}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              maxLength={30}
              returnKeyType="done"
              onSubmitEditing={handleSaveName}
            />
            <TouchableOpacity onPress={handleSaveName} disabled={isSaving} style={styles.nameSaveBtn}>
              {isSaving ? (
                <ActivityIndicator size="small" color={colors.teal} />
              ) : (
                <Text style={styles.nameSaveBtnText}>Save</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditingName(false)} style={styles.nameCancelBtn}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.nameRow}
            onPress={() => {
              setNameInput(profile?.display_name ?? '');
              setEditingName(true);
            }}
          >
            <Text style={styles.displayName}>{displayName}</Text>
            <Ionicons name="pencil" size={14} color={colors.textMuted} style={styles.editIcon} />
          </TouchableOpacity>
        )}

        {profile?.username && (
          <Text style={styles.username}>@{profile.username}</Text>
        )}
        {memberSince && (
          <Text style={styles.memberSince}>Member since {memberSince}</Text>
        )}
      </View>

      {/* ── Stats ── */}
      <View style={styles.statsSection}>
        <StatCard label="Owned" value={ownedPedals.length} accent={colors.teal} />
        <StatCard label="Wishlist" value={wishlistPedals.length} accent={colors.rose} />
        <StatCard label="Boards" value={boards.length} accent={colors.warning} />
      </View>

      {/* ── Premium Card ── */}
      {!isPro && (
        <View style={styles.section}>
          <LinearGradient
            colors={[colors.teal + 'cc', colors.tealDark]}
            style={styles.premiumCard}
          >
            <View style={styles.premiumTop}>
              <View>
                <Text style={styles.premiumBadge}>✦ GO PREMIUM</Text>
                <Text style={styles.premiumTitle}>Unlock Everything</Text>
              </View>
              <Image source={tpcSquare} style={styles.premiumLogo} resizeMode="contain" />
            </View>
            <Text style={styles.premiumDesc}>
              Unlimited boards, advanced Finder uses, early access to new features, and support indie development.
            </Text>
            <View style={styles.premiumPriceRow}>
              <View style={styles.premiumPriceCard}>
                <Text style={styles.premiumPrice}>$6.99</Text>
                <Text style={styles.premiumPricePer}>/ month</Text>
              </View>
              <View style={styles.premiumPriceCard}>
                <Text style={styles.premiumPrice}>$59.99</Text>
                <Text style={styles.premiumPricePer}>/ year</Text>
                <View style={styles.premiumSaveBadge}>
                  <Text style={styles.premiumSaveText}>SAVE 28%</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={styles.premiumCTA}
              activeOpacity={0.85}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                openPaywall('general');
              }}
            >
              <Text style={styles.premiumCTAText}>Go Premium →</Text>
            </TouchableOpacity>
          </LinearGradient>
        </View>
      )}

      {/* ── Tone Profile ── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>TONE PROFILE</Text>
        <View style={styles.settingsCard}>
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => {
              Haptics.selectionAsync();
              setShowToneEditor(true);
            }}
            activeOpacity={0.75}
          >
            <Ionicons name="musical-notes-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsRowText}>
                {profile?.pedal_expert_profile?.onboarding_completed_at
                  ? 'Edit Tone Profile'
                  : 'Set Up Tone Profile'}
              </Text>
              {profile?.pedal_expert_profile?.guitar_heroes ? (
                <Text style={styles.toneProfileSub} numberOfLines={1}>
                  {profile.pedal_expert_profile.guitar_heroes}
                </Text>
              ) : (
                <Text style={styles.toneProfileSub}>
                  Powers your Custom Shop
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Settings ── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>SETTINGS</Text>

        <View style={styles.settingsCard}>
          <View style={styles.settingsRow}>
            <Ionicons name="images-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.settingsRowText}>Collection View</Text>
            <View style={styles.viewModeToggle}>
              <TouchableOpacity
                style={[styles.viewModePill, viewMode === 'tile' && styles.viewModePillActive]}
                onPress={() => setViewMode('tile')}
              >
                <Text style={[styles.viewModeText, viewMode === 'tile' && styles.viewModeTextActive]}>Tile</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewModePill, viewMode === 'text' && styles.viewModePillActive]}
                onPress={() => setViewMode('text')}
              >
                <Text style={[styles.viewModeText, viewMode === 'text' && styles.viewModeTextActive]}>Text</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.settingsDivider} />

          <TouchableOpacity style={styles.settingsRow} disabled>
            <Ionicons name="notifications-outline" size={20} color={colors.textMuted} />
            <Text style={[styles.settingsRowText, { color: colors.textMuted }]}>
              Notifications
            </Text>
            <Text style={styles.comingSoon}>Soon</Text>
          </TouchableOpacity>

          <View style={styles.settingsDivider} />

          <TouchableOpacity style={styles.settingsRow} disabled>
            <Ionicons name="help-circle-outline" size={20} color={colors.textMuted} />
            <Text style={[styles.settingsRowText, { color: colors.textMuted }]}>
              Help & Feedback
            </Text>
            <Text style={styles.comingSoon}>Soon</Text>
          </TouchableOpacity>

          <View style={styles.settingsDivider} />
          <TouchableOpacity style={styles.settingsRow} onPress={handleSubscriptionPress} activeOpacity={0.75}>
            <Ionicons name="card-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.settingsRowText}>
              {isPro ? 'Manage Subscription' : 'Subscribe to Pro'}
            </Text>
            <Ionicons
              name={isPro ? 'open-outline' : 'chevron-forward'}
              size={16}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        </View>
      </View>

      {profile?.is_admin && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ADMIN</Text>
          <View style={styles.settingsCard}>
            <TouchableOpacity
              style={styles.settingsRow}
              onPress={() => navigation.navigate('Admin' as never)}
            >
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.settingsRowText}>Admin Console</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Account info ── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingsRow}>
            <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.settingsRowText} numberOfLines={1}>
              {session?.user.email}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Share My Rig — image card (Instagram/TikTok) + text fallback ── */}
      <View style={styles.shareRigRow}>
        <TouchableOpacity
          style={styles.shareRigBtn}
          onPress={() => {
            Haptics.selectionAsync();
            const genres = profile?.pedal_expert_profile?.genres ?? [];
            triggerRigShare({
              type: 'rig',
              displayName,
              ownedCount: ownedPedals.length,
              genre: genres.length ? genres.slice(0, 2).join(', ') : undefined,
              tone: profile?.pedal_expert_profile?.tone_identity ?? undefined,
            });
          }}
          activeOpacity={0.75}
        >
          <Ionicons name="share-social-outline" size={16} color={colors.teal} />
          <Text style={styles.shareRigText}>Share as Image</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.shareRigBtnText}
          onPress={() => {
            Haptics.selectionAsync();
            shareProfile(displayName, ownedPedals.length, profile?.pedal_expert_profile?.genres ?? [], profile?.pedal_expert_profile?.tone_identity ?? undefined);
          }}
          activeOpacity={0.75}
        >
          <Ionicons name="share-outline" size={14} color={colors.textMuted} />
          <Text style={styles.shareRigTextMuted}>Text</Text>
        </TouchableOpacity>
      </View>
      <HiddenShareCard cardRef={rigCardRef} cardData={rigCardData} />

      {/* ── Sign Out ── */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.75}>
        <Ionicons name="log-out-outline" size={18} color={colors.rose} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>The Pedal Collaborative v1.0</Text>
    </ScrollView>

    {/* ── Tone Profile Editor Modal ── */}
    <Modal
      visible={showToneEditor}
      animationType="slide"
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ToneProfileEditor
          profile={
            profile?.pedal_expert_profile ?? {
              experience_years: '',
              year_started: '',
              tone_identity: '',
              guitar_heroes: '',
              sonic_moments: [],
              guitar_type: '',
              guitar_details: '',
              amp_type: '',
              amp_details: '',
              signal_chain: '',
              genres: [],
              board_philosophy: '',
              brand_attitude: '',
              complexity_tolerance: '',
              budget_range: '',
              tone_chase: '',
              onboarding_completed_at: '',
              profile_updated_at: '',
              profile_refresh_due_at: '',
            }
          }
          onComplete={handleToneProfileSave}
          onDismiss={() => setShowToneEditor(false)}
        />
      </SafeAreaView>
    </Modal>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 48,
  },
  header: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    marginTop: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
    paddingBottom: spacing.xs,
  },
  // Identity
  identitySection: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.base,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {
    fontSize: 36,
    fontFamily: typography.display,
    color: '#fff',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  displayName: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  editIcon: {
    marginTop: 3,
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nameInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.teal + '60',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.lg,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  nameSaveBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.teal,
    borderRadius: radius.lg,
    minWidth: 56,
    alignItems: 'center',
  },
  nameSaveBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  nameCancelBtn: {
    padding: spacing.sm,
  },
  username: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
  },
  memberSince: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  // Stats
  statsSection: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  // Section
  section: {
    padding: spacing.base,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  sectionLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  // Premium card
  premiumCard: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.base,
  },
  premiumTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  premiumBadge: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1,
    marginBottom: 4,
  },
  premiumTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: '#fff',
  },
  premiumLogo: {
    width: 48,
    height: 48,
  },
  premiumDesc: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 20,
  },
  premiumPriceRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  premiumPriceCard: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
    position: 'relative',
    gap: 2,
  },
  premiumPrice: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: '#fff',
  },
  premiumPricePer: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.7)',
  },
  premiumSaveBadge: {
    position: 'absolute',
    top: -8,
    right: -4,
    backgroundColor: colors.rose,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  premiumSaveText: {
    fontSize: 8,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
    letterSpacing: 0.5,
  },
  premiumCTA: {
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  premiumCTAText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.tealDark,
  },
  // Settings
  settingsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
  },
  settingsRowText: {
    flex: 1,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  toneProfileSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: 2,
  },
  viewModeToggle: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  viewModePill: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  viewModePillActive: {
    borderColor: colors.teal + '80',
    backgroundColor: colors.teal + '1A',
  },
  viewModeText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  viewModeTextActive: {
    color: colors.teal,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.base + 20 + spacing.md,
  },
  comingSoon: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  // Share rig
  shareRigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.base,
    marginBottom: spacing.md,
  },
  shareRigBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.teal + '60',
    backgroundColor: colors.teal + '08',
  },
  shareRigText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  shareRigBtnText: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  shareRigTextMuted: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  // Sign out
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.base,
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.rose + '40',
    backgroundColor: colors.rose + '10',
  },
  signOutText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.rose,
  },
  version: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
