import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, typography, spacing, radius } from '../theme';
import { useStore } from '../hooks/useStore';
import { supabase, UserPedal } from '../lib/supabase';
import { RootStackParamList } from '../types/navigation';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function toDisplayDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function toDbDate(display: string): string | null {
  const parts = display.split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts.map(Number);
  if (!m || !d || !y || y < 1900) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function GearHistoryScreen() {
  const navigation = useNavigation<Nav>();
  const { retiredPedals } = useStore();

  const [editing, setEditing]           = useState<UserPedal | null>(null);
  const [retiredDate, setRetiredDate]   = useState('');
  const [method, setMethod]             = useState<'sale' | 'trade'>('sale');
  const [price, setPrice]               = useState('');
  const [tradeFor, setTradeFor]         = useState('');
  const [retiredTo, setRetiredTo]       = useState('');
  const [notes, setNotes]               = useState('');
  const [saving, setSaving]             = useState(false);

  function openEdit(p: UserPedal) {
    Haptics.selectionAsync();
    setRetiredDate(p.retired_date ? toDisplayDate(p.retired_date) : '');
    setMethod(p.retired_method === 'trade' ? 'trade' : 'sale');
    setPrice(p.retired_price != null ? String(p.retired_price) : '');
    setTradeFor(p.retired_trade_for ?? '');
    setRetiredTo(p.retired_to ?? '');
    setNotes(p.retired_notes ?? '');
    setEditing(p);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const dbDate = retiredDate.trim() ? toDbDate(retiredDate.trim()) : editing.retired_date;
      const updates = {
        retired_date:      dbDate,
        retired_method:    method,
        retired_price:     method === 'sale' ? (parseFloat(price) || null) : null,
        retired_trade_for: method === 'trade' ? (tradeFor.trim() || null) : null,
        retired_to:        retiredTo.trim() || null,
        retired_notes:     notes.trim() || null,
      };
      const { error } = await supabase
        .from('user_pedals')
        .update(updates)
        .eq('id', editing.id);
      if (error) throw error;
      // Optimistic local update
      useStore.setState(s => ({
        retiredPedals: s.retiredPedals.map(p =>
          p.id === editing.id ? { ...p, ...updates } : p
        ),
      }));
      setEditing(null);
    } catch {
      Alert.alert('Save failed', 'Could not update this entry. Please try again.');
    } finally {
      setSaving(false);
    }
  }

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
                onPress={() => openEdit(p)}
              >
                <View style={styles.rowLeft}>
                  <Text style={styles.brand}>{pedal.brand}</Text>
                  <Text style={styles.model}>{pedal.model}</Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.meta}>
                    {method}{year ? ` · ${year}` : ''}
                  </Text>
                  <Ionicons name="pencil-outline" size={14} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Edit sheet */}
      <Modal
        visible={editing !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditing(null)}
      >
        <KeyboardAvoidingView
          style={styles.sheetContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
            {/* Sheet header */}
            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={() => setEditing(null)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Text style={styles.sheetCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>
                {editing?.pedal?.brand} {editing?.pedal?.model}
              </Text>
              <TouchableOpacity onPress={saveEdit} disabled={saving} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                {saving
                  ? <ActivityIndicator color={colors.teal} />
                  : <Text style={styles.sheetSave}>Save</Text>
                }
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Date</Text>
              <TextInput
                style={styles.input}
                placeholder="MM/DD/YYYY"
                placeholderTextColor={colors.textMuted}
                value={retiredDate}
                onChangeText={setRetiredDate}
                keyboardType="numbers-and-punctuation"
              />

              <Text style={styles.fieldLabel}>Method</Text>
              <View style={styles.segRow}>
                <TouchableOpacity
                  style={[styles.seg, method === 'sale' && styles.segActive]}
                  onPress={() => setMethod('sale')}
                >
                  <Text style={[styles.segText, method === 'sale' && styles.segTextActive]}>Sold</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.seg, method === 'trade' && styles.segActive]}
                  onPress={() => setMethod('trade')}
                >
                  <Text style={[styles.segText, method === 'trade' && styles.segTextActive]}>Traded</Text>
                </TouchableOpacity>
              </View>

              {method === 'sale' ? (
                <>
                  <Text style={styles.fieldLabel}>Sale price</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    value={price}
                    onChangeText={setPrice}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Traded for</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="What did you get?"
                    placeholderTextColor={colors.textMuted}
                    value={tradeFor}
                    onChangeText={setTradeFor}
                  />
                </>
              )}

              <Text style={styles.fieldLabel}>{method === 'sale' ? 'Sold to' : 'Traded with'}</Text>
              <TextInput
                style={styles.input}
                placeholder="Name or username (optional)"
                placeholderTextColor={colors.textMuted}
                value={retiredTo}
                onChangeText={setRetiredTo}
              />

              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="Any notes..."
                placeholderTextColor={colors.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
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
  // ── Edit sheet ──
  sheetContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetCancel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  sheetTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  sheetSave: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  sheetBody: {
    padding: spacing.base,
    paddingBottom: 48,
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },
  segRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  seg: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  segActive: {
    backgroundColor: colors.teal + '20',
    borderColor: colors.teal,
  },
  segText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  segTextActive: {
    color: colors.teal,
  },
});
