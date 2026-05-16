import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, typography, spacing, radius } from '../theme';
import { useStore } from '../hooks/useStore';
import { RootStackParamList } from '../types/navigation';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function GearHistoryScreen() {
  const navigation = useNavigation<Nav>();
  const { retiredPedals } = useStore();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { Haptics.selectionAsync(); navigation.goBack(); }}
          style={styles.backBtn}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Gear History</Text>
        <View style={styles.backBtn} />
      </View>

      {retiredPedals.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="archive-outline" size={44} color={colors.textMuted} style={{ opacity: 0.35 }} />
          <Text style={styles.emptyText}>Pedals you've moved on from will appear here</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {retiredPedals.map((p, i) => {
            const pedal = p.pedal;
            if (!pedal) return null;
            const year = p.retired_date
              ? new Date(p.retired_date).getFullYear()
              : null;
            const method =
              p.retired_method === 'sale'
                ? 'Sold'
                : p.retired_method === 'trade'
                ? 'Traded'
                : 'Retired';
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.selectionAsync();
                  navigation.goBack();
                  // Small delay so this screen pops before Vault navigates
                  setTimeout(() => {
                    (navigation as any).navigate('Main', {
                      screen: 'Vault',
                      params: { openPedalId: p.id },
                    });
                  }, 300);
                }}
              >
                <View style={styles.rowLeft}>
                  <Text style={styles.brand}>{pedal.brand}</Text>
                  <Text style={styles.model}>{pedal.model}</Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.meta}>
                    {method}{year ? ` · ${year}` : ''}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  list: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: 48,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLeft: {
    flex: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  brand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  model: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    marginTop: 2,
  },
  meta: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
