/**
 * PublicProfileScreen — read-only vault profile for a TPC member.
 *
 * Reached via:
 *   • Deep link:  tpc://profile/:username
 *   • In-app nav: navigate('PublicProfile', { username })
 *
 * Uses the get_public_profile(username) RPC which is anon-accessible,
 * so this screen works even when the viewer is not logged in.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, typography, spacing, radius, categoryColors } from '../theme';
import { supabase, publicProfileUrl } from '../lib/supabase';
import type { RootStackParamList } from '../types/navigation';

interface PublicProfile {
  display_name:  string | null;
  username:      string;
  member_since:  string;
  tone_identity: string | null;
  genres:        string[] | null;
  playing_style: string | null;
  owned_count:   number;
  board_count:   number;
  pedals: Array<{
    brand:     string;
    model:     string;
    category:  string;
    image_url: string | null;
  }>;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function PublicProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route      = useRoute<RouteProp<RootStackParamList, 'PublicProfile'>>();
  const { username } = route.params;

  const [profile,  setProfile]  = useState<PublicProfile | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    supabase
      .rpc('get_public_profile', { p_username: username.toLowerCase() })
      .then(({ data, error }) => {
        setLoading(false);
        if (error || !data) { setNotFound(true); return; }
        setProfile(data as PublicProfile);
      });
  }, [username]);

  const handleShare = async () => {
    Haptics.selectionAsync();
    const url = publicProfileUrl(username);
    await Share.share({
      message: `Check out ${profile?.display_name ?? '@' + username}'s vault on The Pedal Collaborative — ${url}`,
      url,
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.backRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.backRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <Ionicons name="person-outline" size={40} color={colors.textMuted} />
          <Text style={styles.notFoundTitle}>Profile not found</Text>
          <Text style={styles.notFoundSub}>This profile is private or doesn't exist.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const name     = profile.display_name ?? `@${profile.username}`;
  const initials = name.charAt(0).toUpperCase();
  const chips    = [
    ...(profile.genres ?? []),
    profile.playing_style,
    profile.tone_identity,
  ].filter(Boolean) as string[];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header nav */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Profile</Text>
        <TouchableOpacity onPress={handleShare} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="share-outline" size={22} color={colors.teal} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Avatar + identity */}
        <View style={styles.heroSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.displayName}>{name}</Text>
          <Text style={styles.usernameText}>@{profile.username}</Text>
          <Text style={styles.memberSince}>Member since {profile.member_since}</Text>
        </View>

        {/* Tone chips */}
        {chips.length > 0 && (
          <View style={styles.chipsRow}>
            {chips.map((c, i) => (
              <View key={i} style={styles.chip}>
                <Text style={styles.chipText}>{c}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{profile.owned_count}</Text>
            <Text style={styles.statLbl}>In the Vault</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{profile.board_count}</Text>
            <Text style={styles.statLbl}>Boards</Text>
          </View>
        </View>

        {/* Pedal grid */}
        {profile.pedals.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>THE VAULT</Text>
            <View style={styles.pedalGrid}>
              {profile.pedals.map((p, i) => {
                const catColor = categoryColors[p.category] ?? colors.textMuted;
                return (
                  <View key={i} style={styles.pedalCard}>
                    {p.image_url ? (
                      <Image
                        source={{ uri: p.image_url }}
                        style={styles.pedalImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.pedalImg, styles.pedalImgPlaceholder, { backgroundColor: catColor + '22' }]}>
                        <Ionicons name="hardware-chip-outline" size={22} color={catColor} />
                      </View>
                    )}
                    <View style={styles.pedalInfo}>
                      <Text style={styles.pedalBrand} numberOfLines={1}>{p.brand}</Text>
                      <Text style={styles.pedalModel} numberOfLines={2}>{p.model}</Text>
                      <View style={[styles.pedalCat, { backgroundColor: catColor + '22' }]}>
                        <Text style={[styles.pedalCatText, { color: catColor }]}>{cap(p.category)}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* CTA for non-members */}
        <View style={styles.ctaBox}>
          <Text style={styles.ctaText}>Catalog your gear, get AI tone advice, and share your vault.</Text>
          <Text style={styles.ctaApp}>The Pedal Collaborative — Free on the App Store</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const CARD_GAP = spacing.sm;
const CARD_W   = '47%';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  scroll:    { paddingBottom: spacing.xxl },

  backRow: { padding: spacing.base },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },

  // Not found
  notFoundTitle: { fontSize: typography.sizes.lg, fontFamily: typography.bodySemiBold, color: colors.textPrimary, textAlign: 'center' },
  notFoundSub:   { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textMuted, textAlign: 'center' },

  // Hero
  heroSection: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.md, paddingHorizontal: spacing.base },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText:    { fontSize: typography.sizes.xxl, fontFamily: typography.bodySemiBold, color: '#fff' },
  displayName:   { fontSize: typography.sizes.xl, fontFamily: typography.bodySemiBold, color: colors.textPrimary, textAlign: 'center' },
  usernameText:  { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.teal, marginTop: 2 },
  memberSince:   { fontSize: typography.sizes.xs, fontFamily: typography.body, color: colors.textMuted, marginTop: 4 },

  // Chips
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'center', paddingHorizontal: spacing.base, paddingBottom: spacing.md },
  chip:     { backgroundColor: colors.teal + '18', borderWidth: 1, borderColor: colors.teal + '40', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  chipText: { fontSize: typography.sizes.xs, fontFamily: typography.bodySemiBold, color: colors.teal },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.base,
    marginHorizontal: spacing.base,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    gap: spacing.xl,
  },
  stat:        { alignItems: 'center' },
  statNum:     { fontSize: typography.sizes.xl, fontFamily: typography.bodySemiBold, color: colors.textPrimary },
  statLbl:     { fontSize: typography.sizes.xs, fontFamily: typography.body, color: colors.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },

  // Section label
  sectionLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.base,
    marginBottom: spacing.sm,
  },

  // Pedal grid
  pedalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
    paddingHorizontal: spacing.base,
    marginBottom: spacing.xl,
  },
  pedalCard: {
    width: CARD_W,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pedalImg:            { width: '100%', aspectRatio: 1 },
  pedalImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  pedalInfo:    { padding: spacing.sm },
  pedalBrand:   { fontSize: typography.sizes.xs, fontFamily: typography.body, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  pedalModel:   { fontSize: typography.sizes.sm, fontFamily: typography.bodySemiBold, color: colors.textPrimary, marginTop: 2, lineHeight: 17 },
  pedalCat:     { alignSelf: 'flex-start', marginTop: spacing.xs, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.full },
  pedalCatText: { fontSize: 10, fontFamily: typography.bodySemiBold },

  // CTA
  ctaBox: {
    margin: spacing.base,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.xs,
  },
  ctaText: { fontSize: typography.sizes.sm, fontFamily: typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  ctaApp:  { fontSize: typography.sizes.xs, fontFamily: typography.bodySemiBold, color: colors.teal, textAlign: 'center' },
});
