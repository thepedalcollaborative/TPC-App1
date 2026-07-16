import React, { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  Switch,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types/navigation';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';
import { useStore } from '../hooks/useStore';
import { supabase, FullExpertProfile, publicProfileUrl } from '../lib/supabase';
import { ToneProfileEditor } from '../components';
import { StatCard, TPCLogoMark } from '../components';
import { hasBetaFullAccess } from '../lib/subscription';
import { connectPatreon } from '../lib/patreon';
import { CURRENCIES, type CurrencyCode, formatMoney } from '../lib/formatMoney';
import * as Notifications from 'expo-notifications';
import {
  requestNotificationPermissions,
  scheduleWeeklyPickNotification,
  scheduleVaultDigestNotification,
  cancelAllTpcNotifications,
} from '../lib/notifications';
import { SwipeDismissSheet } from '../components/SwipeDismissSheet';

const tpcSquare = require('../../assets/tpc-square.png');

interface VaultStats {
  repeat_offenders: Array<{ brand: string; model: string; times: number }> | null;
  most_expensive:   { brand: string; model: string; price: number } | null;
  biggest_loss:     { brand: string; model: string; loss: number }  | null;
  quickest_flip:    { brand: string; model: string; days: number }  | null;
  longest_in_vault: { brand: string; model: string; days: number }  | null;
  total_spent:      number;
  category_obsession: string | null;
  brand_loyalty:      string | null;
  total_through_hands: number;
}

function fmtDays(days: number): string {
  if (days < 2)   return '1 day';
  if (days < 30)  return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  const yrs = (days / 365);
  return `${yrs % 1 === 0 ? yrs.toFixed(0) : yrs.toFixed(1)} yr${yrs >= 2 ? 's' : ''}`;
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session, profile, ownedPedals, wishlistPedals, retiredPedals, boards, fetchProfile, signOut, deleteAccount, viewMode, setViewMode, openPaywall, totalMarketValue, wifeMode, setWifeMode, currency, setCurrency } =
    useStore();

  const [premiumMinimized, setPremiumMinimized] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.display_name ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [showToneEditor, setShowToneEditor] = useState(false);
  const isPro = Boolean(profile?.is_premium) || hasBetaFullAccess();
  const isPatreonPro = profile?.pro_source === 'patreon';
  const [patreonLoading, setPatreonLoading] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [activityInTrends, setActivityInTrends] = useState<boolean>(
    profile?.allow_activity_in_trends !== false
  );
  const [vaultStats, setVaultStats] = useState<VaultStats | null>(null);
  const [showRepeatOffenders, setShowRepeatOffenders] = useState(false);
  const [isPublicProfile, setIsPublicProfile] = useState<boolean>(
    profile?.is_public_profile === true
  );

  const handleActivityInTrendsToggle = async (value: boolean) => {
    Haptics.selectionAsync();
    setActivityInTrends(value);
    if (!session?.user?.id) return;
    await supabase
      .from('user_profiles')
      .update({ allow_activity_in_trends: value })
      .eq('id', session.user.id);
  };

  const handlePublicProfileToggle = async (value: boolean) => {
    Haptics.selectionAsync();
    setIsPublicProfile(value);
    if (!session?.user?.id) return;
    await supabase
      .from('user_profiles')
      .update({ is_public_profile: value })
      .eq('id', session.user.id);
  };

  const handleShareProfile = async () => {
    if (!profile?.username) return;
    Haptics.selectionAsync();
    const url  = publicProfileUrl(profile.username);
    const name = profile.display_name ?? `@${profile.username}`;
    await Share.share({
      message: `Check out ${name}'s gear vault on The Pedal Collaborative — ${url}`,
      url,
    });
  };

  const handleConnectPatreon = async () => {
    Haptics.selectionAsync();
    setPatreonLoading(true);
    try {
      const result = await connectPatreon();
      if (result.success) {
        await fetchProfile();
        if (result.isPro) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Patreon Connected! ✦',
            result.tier
              ? `Your "${result.tier}" tier grants you Pro access. Thank you for supporting TPC!`
              : 'Your Patreon membership grants you Pro access. Thank you for supporting TPC!',
          );
        } else {
          Alert.alert(
            'Patreon Linked',
            "Your Patreon account is connected, but your current tier doesn't include Pro access. Upgrade your Patreon pledge to unlock Pro.",
          );
        }
      } else if (!result.cancelled) {
        Alert.alert('Connection Failed', result.error ?? 'Could not connect Patreon. Please try again.');
      }
    } finally {
      setPatreonLoading(false);
    }
  };

  // ── Notification toggles ───────────────────────────────────────────────────
  const [notifWeeklyPick, setNotifWeeklyPick] = useState(false);
  const [notifVaultDigest, setNotifVaultDigest] = useState(false);
  const [notifPermDenied, setNotifPermDenied] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('premium_card_minimized').then(v => {
      if (v === '1') setPremiumMinimized(true);
    });
  }, []);

  // ── Vault stats ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .rpc('get_vault_stats', { p_user_id: session.user.id })
      .then(({ data }) => { if (data) setVaultStats(data as VaultStats); });
  }, [session?.user?.id]);

  const togglePremiumMinimized = useCallback(() => {
    setPremiumMinimized(prev => {
      const next = !prev;
      AsyncStorage.setItem('premium_card_minimized', next ? '1' : '0');
      return next;
    });
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') { setNotifPermDenied(true); return; }
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const ids = scheduled.map(n => n.identifier);
      setNotifWeeklyPick(ids.includes('tpc-weekly-pick'));
      setNotifVaultDigest(ids.includes('tpc-vault-digest'));
    })();
  }, []);

  const handleNotifToggle = async (type: 'weekly' | 'vault', value: boolean) => {
    if (value) {
      const granted = await requestNotificationPermissions();
      if (!granted) { setNotifPermDenied(true); return; }
      setNotifPermDenied(false);
    }
    if (type === 'weekly') {
      setNotifWeeklyPick(value);
      if (value) {
        await scheduleWeeklyPickNotification();
      } else {
        await Notifications.cancelScheduledNotificationAsync('tpc-weekly-pick').catch(() => {});
      }
    } else {
      setNotifVaultDigest(value);
      if (value) {
        await scheduleVaultDigestNotification(ownedPedals.length, totalMarketValue);
      } else {
        await Notifications.cancelScheduledNotificationAsync('tpc-vault-digest').catch(() => {});
      }
    }
  };
  // ──────────────────────────────────────────────────────────────────────────

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

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your account, all your pedals, boards, and data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: () => {
            // Second confirmation — extra friction for an irreversible action
            Alert.alert(
              'Are you sure?',
              'All your data will be permanently deleted. There is no way to recover it.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete Everything',
                  style: 'destructive',
                  onPress: async () => {
                    const { success, error } = await deleteAccount();
                    if (!success) {
                      Alert.alert('Error', error ?? 'Could not delete account. Please try again.');
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const handleToneProfileSave = async (updated: FullExpertProfile) => {
    if (!session) return;
    const { error } = await supabase
      .from('user_profiles')
      .update({ pedal_expert_profile: updated })
      .eq('id', session.user.id);
    if (error) {
      console.warn('[Profile] tone save error:', error.message);
      return;
    }
    await fetchProfile();
    Haptics.selectionAsync();
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
        <StatCard label="GAS List" value={wishlistPedals.length} accent={colors.rose} />
        <StatCard label="Boards" value={boards.length} accent={colors.warning} />
      </View>

      {/* ── Premium Card ── */}
      {!isPro && (
        <View style={styles.section}>
          {premiumMinimized ? (
            <TouchableOpacity
              style={styles.premiumMinimized}
              onPress={() => { Haptics.selectionAsync(); togglePremiumMinimized(); }}
              activeOpacity={0.8}
            >
              <Text style={styles.premiumMinimizedText}>✦ GO PRO</Text>
              <Ionicons name="chevron-down" size={14} color={colors.teal} />
            </TouchableOpacity>
          ) : (
            <LinearGradient
              colors={[colors.teal + 'cc', colors.tealDark]}
              style={styles.premiumCard}
            >
              <View style={styles.premiumTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.premiumBadge}>✦ GO PRO</Text>
                  <Text style={styles.premiumTitle}>Unlock Everything</Text>
                </View>
                <TouchableOpacity
                  onPress={() => { Haptics.selectionAsync(); togglePremiumMinimized(); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.premiumMinimizeBtn}
                >
                  <Ionicons name="chevron-up" size={18} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>
              </View>
              <Text style={styles.premiumDesc}>
                Unlimited boards, advanced Finder uses, early access to new features, and support indie development.
              </Text>
              <View style={styles.premiumPriceRow}>
                <View style={styles.premiumPriceCard}>
                  <Text style={styles.premiumPrice}>$3.99</Text>
                  <Text style={styles.premiumPricePer}>/ month</Text>
                </View>
                <View style={styles.premiumPriceCard}>
                  <Text style={styles.premiumPrice}>$29.99</Text>
                  <Text style={styles.premiumPricePer}>/ year</Text>
                  <View style={styles.premiumSaveBadge}>
                    <Text style={styles.premiumSaveText}>SAVE 37%</Text>
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
                <Text style={styles.premiumCTAText}>Go Pro →</Text>
              </TouchableOpacity>
            </LinearGradient>
          )}
        </View>
      )}

      {/* ── Your Gear Story ── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>YOUR GEAR STORY</Text>
        <View style={styles.settingsCard}>
          {/* Tone profile row */}
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

          {/* Gear History */}
          <View style={styles.settingsDivider} />
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => { Haptics.selectionAsync(); navigation.navigate('GearHistory'); }}
            activeOpacity={0.75}
          >
            <Ionicons name="archive-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsRowText}>Gear History</Text>
              {retiredPedals.length > 0 && (
                <Text style={styles.settingsRowSub}>
                  {retiredPedals.length} pedal{retiredPedals.length !== 1 ? 's' : ''} moved on from
                </Text>
              )}
            </View>
            {retiredPedals.length > 0 && (
              <View style={styles.gearHistoryBadge}>
                <Text style={styles.gearHistoryBadgeText}>{retiredPedals.length}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Vault Stats ── */}
      {vaultStats && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>VAULT STATS</Text>
          <View style={styles.settingsCard}>

            {/* Repeat Offenders */}
            {vaultStats.repeat_offenders && vaultStats.repeat_offenders.length > 0 && (
              <>
                <TouchableOpacity
                  style={styles.settingsRow}
                  onPress={() => { Haptics.selectionAsync(); setShowRepeatOffenders(v => !v); }}
                  activeOpacity={0.75}
                >
                  <Ionicons name="repeat-outline" size={20} color={colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsRowText}>Repeat Offenders</Text>
                    <Text style={styles.settingsRowSub}>Pedals you keep coming back to</Text>
                  </View>
                  <Text style={styles.statValue}>{vaultStats.repeat_offenders.length}</Text>
                  <Ionicons
                    name={showRepeatOffenders ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
                {showRepeatOffenders && (
                  <View style={styles.repeatOffendersList}>
                    {vaultStats.repeat_offenders.map((p, i) => (
                      <View key={i} style={styles.repeatOffenderRow}>
                        <Ionicons name="arrow-redo-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.repeatOffenderName}>{p.brand} {p.model}</Text>
                        <Text style={styles.repeatOffenderTimes}>×{p.times}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View style={styles.settingsDivider} />
              </>
            )}

            {/* Most Expensive */}
            {vaultStats.most_expensive && (
              <>
                <View style={styles.settingsRow}>
                  <Ionicons name="pricetag-outline" size={20} color={colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsRowText}>Most Expensive Owned</Text>
                    <Text style={styles.settingsRowSub} numberOfLines={1}>
                      {vaultStats.most_expensive.brand} {vaultStats.most_expensive.model}
                    </Text>
                  </View>
                  <Text style={styles.statValue}>
                    {formatMoney(vaultStats.most_expensive.price, currency, wifeMode)}
                  </Text>
                </View>
                <View style={styles.settingsDivider} />
              </>
            )}

            {/* Biggest Loss */}
            {vaultStats.biggest_loss && (
              <>
                <View style={styles.settingsRow}>
                  <Ionicons name="trending-down-outline" size={20} color={colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsRowText}>Biggest Loss</Text>
                    <Text style={styles.settingsRowSub} numberOfLines={1}>
                      {vaultStats.biggest_loss.brand} {vaultStats.biggest_loss.model}
                    </Text>
                  </View>
                  <Text style={styles.statValue}>
                    −{formatMoney(vaultStats.biggest_loss.loss, currency, wifeMode)}
                  </Text>
                </View>
                <View style={styles.settingsDivider} />
              </>
            )}

            {/* Quickest Flip */}
            {vaultStats.quickest_flip && (
              <>
                <View style={styles.settingsRow}>
                  <Ionicons name="flash-outline" size={20} color={colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsRowText}>Quickest Flip</Text>
                    <Text style={styles.settingsRowSub} numberOfLines={1}>
                      {vaultStats.quickest_flip.brand} {vaultStats.quickest_flip.model}
                    </Text>
                  </View>
                  <Text style={styles.statValue}>{fmtDays(vaultStats.quickest_flip.days)}</Text>
                </View>
                <View style={styles.settingsDivider} />
              </>
            )}

            {/* Longest in Vault */}
            {vaultStats.longest_in_vault && (
              <>
                <View style={styles.settingsRow}>
                  <Ionicons name="hourglass-outline" size={20} color={colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsRowText}>Longest in the Vault</Text>
                    <Text style={styles.settingsRowSub} numberOfLines={1}>
                      {vaultStats.longest_in_vault.brand} {vaultStats.longest_in_vault.model}
                    </Text>
                  </View>
                  <Text style={styles.statValue}>{fmtDays(vaultStats.longest_in_vault.days)}</Text>
                </View>
                <View style={styles.settingsDivider} />
              </>
            )}

            {/* Total Spent */}
            {vaultStats.total_spent > 0 && (
              <>
                <View style={styles.settingsRow}>
                  <Ionicons name="wallet-outline" size={20} color={colors.textSecondary} />
                  <Text style={styles.settingsRowText}>Total Spent on Pedals</Text>
                  <Text style={styles.statValue}>
                    {formatMoney(vaultStats.total_spent, currency, wifeMode)}
                  </Text>
                </View>
                <View style={styles.settingsDivider} />
              </>
            )}

            {/* Category Obsession */}
            {vaultStats.category_obsession && (
              <>
                <View style={styles.settingsRow}>
                  <Ionicons name="layers-outline" size={20} color={colors.textSecondary} />
                  <Text style={styles.settingsRowText}>Category Obsession</Text>
                  <Text style={styles.statValue}>
                    {vaultStats.category_obsession.charAt(0).toUpperCase() + vaultStats.category_obsession.slice(1)}
                  </Text>
                </View>
                <View style={styles.settingsDivider} />
              </>
            )}

            {/* Brand Loyalty */}
            {vaultStats.brand_loyalty && (
              <View style={styles.settingsRow}>
                <Ionicons name="ribbon-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.settingsRowText}>Brand Loyalty</Text>
                <Text style={styles.statValue}>{vaultStats.brand_loyalty}</Text>
              </View>
            )}

          </View>
        </View>
      )}

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

          {/* Bliss Mode */}
          <View style={styles.settingsRow}>
            <Ionicons name="eye-off-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsRowText}>Bliss Mode</Text>
              <Text style={styles.settingsRowSub}>Hides dollar amounts from view</Text>
            </View>
            <Switch
              value={wifeMode}
              onValueChange={(v) => { Haptics.selectionAsync(); setWifeMode(v); }}
              trackColor={{ false: colors.border, true: colors.teal + '99' }}
              thumbColor={wifeMode ? colors.teal : colors.textMuted}
              ios_backgroundColor={colors.border}
            />
          </View>

          <View style={styles.settingsDivider} />

          {/* Currency */}
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => { Haptics.selectionAsync(); setShowCurrencyPicker(true); }}
            activeOpacity={0.75}
          >
            <Ionicons name="cash-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsRowText}>Currency</Text>
              <Text style={styles.settingsRowSub}>
                {CURRENCIES.find(c => c.code === currency)?.label ?? 'US Dollar'}
              </Text>
            </View>
            <Text style={styles.currencyCode}>{currency}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.settingsDivider} />

          <View style={styles.settingsRow}>
            <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.settingsRowText}>Notifications</Text>
          </View>
          {notifPermDenied && (
            <TouchableOpacity
              style={styles.notifPermRow}
              onPress={() => Linking.openSettings()}
            >
              <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
              <Text style={styles.notifPermText}>Enable in Settings to receive notifications</Text>
            </TouchableOpacity>
          )}
          <View style={styles.settingsSubRow}>
            <Text style={styles.settingsSubLabel}>Weekly Pick</Text>
            <Switch
              value={notifWeeklyPick}
              onValueChange={v => handleNotifToggle('weekly', v)}
              trackColor={{ false: colors.border, true: colors.teal + '99' }}
              thumbColor={notifWeeklyPick ? colors.teal : colors.textMuted}
              ios_backgroundColor={colors.border}
            />
          </View>
          <View style={styles.settingsSubRow}>
            <Text style={styles.settingsSubLabel}>Vault Digest (Sundays)</Text>
            <Switch
              value={notifVaultDigest}
              onValueChange={v => handleNotifToggle('vault', v)}
              trackColor={{ false: colors.border, true: colors.teal + '99' }}
              thumbColor={notifVaultDigest ? colors.teal : colors.textMuted}
              ios_backgroundColor={colors.border}
            />
          </View>

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
              onPress={() => navigation.navigate('Admin')}
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
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => { Haptics.selectionAsync(); navigation.navigate('AccountSettings'); }}
            activeOpacity={0.75}
          >
            <Ionicons name="person-circle-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsRowText}>Account Settings</Text>
              <Text style={styles.settingsRowSub} numberOfLines={1}>{session?.user.email}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.settingsDivider} />

          {/* Patreon connect / status row */}
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={isPatreonPro ? undefined : handleConnectPatreon}
            disabled={patreonLoading || isPatreonPro}
            activeOpacity={isPatreonPro ? 1 : 0.75}
          >
            {patreonLoading ? (
              <ActivityIndicator size="small" color={colors.teal} />
            ) : (
              <PatreonIcon color={isPatreonPro ? colors.warning : colors.textSecondary} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsRowText}>
                {isPatreonPro ? 'Patreon Connected' : 'Connect Patreon'}
              </Text>
              {isPatreonPro && (
                <Text style={styles.toneProfileSub}>Pro access via Patreon membership</Text>
              )}
            </View>
            {isPatreonPro ? (
              <View style={styles.patreonBadge}>
                <Text style={styles.patreonBadgeText}>✦ PRO</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            )}
          </TouchableOpacity>
        </View>
      </View>


      {/* ── Privacy ── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>PRIVACY</Text>
        <View style={styles.settingsCard}>

          {/* Public profile toggle */}
          <View style={styles.settingsRow}>
            <Ionicons name="earth-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsRowText}>Public Vault Profile</Text>
              <Text style={styles.settingsRowSub}>Let others view your vault via a shareable link</Text>
            </View>
            <Switch
              value={isPublicProfile}
              onValueChange={handlePublicProfileToggle}
              trackColor={{ false: colors.border, true: colors.teal + '99' }}
              thumbColor={isPublicProfile ? colors.teal : colors.textMuted}
              ios_backgroundColor={colors.border}
            />
          </View>

          {/* Share link — only shown when public is on and they have a username */}
          {isPublicProfile && profile?.username && (
            <>
              <View style={styles.settingsDivider} />
              <TouchableOpacity
                style={styles.settingsRow}
                onPress={handleShareProfile}
                activeOpacity={0.75}
              >
                <Ionicons name="share-outline" size={20} color={colors.teal} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingsRowText, { color: colors.teal }]}>Share My Profile</Text>
                  <Text style={styles.settingsRowSub} numberOfLines={1}>
                    Send anyone a link to your public vault
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.teal} />
              </TouchableOpacity>
            </>
          )}

          <View style={styles.settingsDivider} />

          {/* Community trends toggle */}
          <View style={styles.settingsRow}>
            <Ionicons name="bar-chart-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsRowText}>Community Trends</Text>
              <Text style={styles.settingsRowSub}>Include my activity in anonymous community counts</Text>
            </View>
            <Switch
              value={activityInTrends}
              onValueChange={handleActivityInTrendsToggle}
              trackColor={{ false: colors.border, true: colors.teal + '99' }}
              thumbColor={activityInTrends ? colors.teal : colors.textMuted}
              ios_backgroundColor={colors.border}
            />
          </View>

        </View>
      </View>

      {/* ── Legal ── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>LEGAL</Text>
        <View style={styles.settingsCard}>
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => { Haptics.selectionAsync(); navigation.navigate('Legal', { tab: 'privacy' }); }}
            activeOpacity={0.75}
          >
            <Ionicons name="shield-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.settingsRowText}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.settingsDivider} />
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => { Haptics.selectionAsync(); navigation.navigate('Legal', { tab: 'terms' }); }}
            activeOpacity={0.75}
          >
            <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.settingsRowText}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Sign Out ── */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.75}>
        <Ionicons name="log-out-outline" size={18} color={colors.rose} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      {/* ── Delete Account ── */}
      <TouchableOpacity style={styles.deleteAccountBtn} onPress={handleDeleteAccount} activeOpacity={0.75}>
        <Text style={styles.deleteAccountText}>Delete Account</Text>
      </TouchableOpacity>

      <Text style={styles.version}>The Pedal Collaborative v1.0</Text>
    </ScrollView>

    {/* ── Currency Picker Modal ── */}
    <Modal
      visible={showCurrencyPicker}
      transparent
      animationType="slide"
      onRequestClose={() => setShowCurrencyPicker(false)}
    >
      <View style={styles.currencyOverlay}>
        <TouchableOpacity
          style={styles.currencyBackdrop}
          activeOpacity={1}
          onPress={() => setShowCurrencyPicker(false)}
        />
        <SwipeDismissSheet style={[styles.currencySheet, { paddingBottom: insets.bottom + 16 }]} onDismiss={() => setShowCurrencyPicker(false)}>
          <Text style={styles.currencyTitle}>Currency</Text>
          {CURRENCIES.map((c) => (
            <TouchableOpacity
              key={c.code}
              style={[
                styles.currencyRow,
                c.code === currency && styles.currencyRowActive,
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setCurrency(c.code as CurrencyCode);
                setShowCurrencyPicker(false);
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.currencySymbol}>{c.symbol}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.currencyLabel, c.code === currency && styles.currencyLabelActive]}>
                  {c.label}
                </Text>
                <Text style={styles.currencyCodeSub}>{c.code}</Text>
              </View>
              {c.code === currency && (
                <Ionicons name="checkmark" size={18} color={colors.teal} />
              )}
            </TouchableOpacity>
          ))}
        </SwipeDismissSheet>
      </View>
    </Modal>

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

// ─── Patreon "P" icon (inline, no svg lib needed) ────────────────────────────
function PatreonIcon({ color }: { color: string }) {
  return (
    <View style={[patreonIconStyles.circle, { borderColor: color + '60' }]}>
      <Text style={[patreonIconStyles.letter, { color }]}>P</Text>
    </View>
  );
}

const patreonIconStyles = StyleSheet.create({
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
});

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
  premiumMinimized: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.teal + '18',
    borderWidth: 1,
    borderColor: colors.teal + '55',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  premiumMinimizedText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    letterSpacing: 1,
  },
  premiumMinimizeBtn: {
    padding: 2,
  },
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
  gearHistoryBadge: {
    backgroundColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  gearHistoryBadgeText: {
    fontSize: 11,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
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
  settingsSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
  settingsSubLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    marginLeft: 20 + spacing.md, // align with icon rows above
  },
  notifPermRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xs,
    marginLeft: 20 + spacing.md,
  },
  notifPermText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.warning,
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
  // Delete account — intentionally low-contrast to avoid accidental taps
  deleteAccountBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  deleteAccountText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  version: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  settingsRowIcon: {
    fontSize: 18,
    width: 20,
    textAlign: 'center',
  },
  settingsRowSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: 1,
  },
  // Vault stats
  statValue: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textSecondary,
    maxWidth: 120,
    textAlign: 'right',
  },
  repeatOffendersList: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  repeatOffenderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  repeatOffenderName: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
  },
  repeatOffenderTimes: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  currencyCode: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  // Currency picker modal
  currencyOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  currencyBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  currencySheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.base,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  currencyHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  currencyTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    gap: spacing.md,
  },
  currencyRowActive: {
    backgroundColor: colors.teal + '12',
  },
  currencySymbol: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textSecondary,
    width: 28,
    textAlign: 'center',
  },
  currencyLabel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  currencyLabelActive: {
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  currencyCodeSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: 1,
  },
  patreonBadge: {
    backgroundColor: colors.warning + '20',
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.warning + '50',
  },
  patreonBadgeText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.warning,
    letterSpacing: 0.5,
  },

});
