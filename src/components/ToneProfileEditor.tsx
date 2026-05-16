import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, typography, spacing, radius } from '../theme';
import { FullExpertProfile } from '../lib/supabase';
import { STEPS, StepConfig, getLabelForValue } from '../lib/onboardingSteps';

// ─── Summary row definitions ──────────────────────────────────────────────────

type ProfileRow = {
  label: string;
  stepIndex: number;
  getValue: (p: FullExpertProfile) => string;
};

const PROFILE_ROWS: ProfileRow[] = [
  {
    label: 'Experience',
    stepIndex: 0,
    getValue: p => {
      const label = getLabelForValue('experience_years', p.experience_years);
      return p.year_started ? `${label} (since ${p.year_started})` : label || '—';
    },
  },
  {
    label: 'Tone in three words',
    stepIndex: 1,
    getValue: p => p.tone_identity || '—',
  },
  {
    label: 'Guitar heroes',
    stepIndex: 2,
    getValue: p => p.guitar_heroes || '—',
  },
  {
    label: 'Sonic moments',
    stepIndex: 3,
    getValue: p => {
      const arr = p.sonic_moments ?? [];
      if (!arr.length) return '—';
      const labels = arr.map(v => getLabelForValue('sonic_moments', v));
      return labels.slice(0, 2).join(', ') + (arr.length > 2 ? ` +${arr.length - 2} more` : '');
    },
  },
  {
    label: 'Rig',
    stepIndex: 4,
    getValue: p => {
      const details = [p.guitar_details, p.amp_details].filter(Boolean).join(' · ');
      if (details) return details;
      const g = getLabelForValue('guitar_type', p.guitar_type);
      const a = getLabelForValue('amp_type', p.amp_type);
      return [g, a].filter(Boolean).join(' · ') || '—';
    },
  },
  {
    label: 'Signal chain',
    stepIndex: 5,
    getValue: p => getLabelForValue('signal_chain', p.signal_chain) || '—',
  },
  {
    label: 'Genres',
    stepIndex: 6,
    getValue: p => {
      const arr = p.genres ?? [];
      if (!arr.length) return '—';
      const labels = arr.map(v => getLabelForValue('genres', v));
      return labels.slice(0, 3).join(', ') + (arr.length > 3 ? ` +${arr.length - 3} more` : '');
    },
  },
  {
    label: 'Board philosophy',
    stepIndex: 7,
    getValue: p => getLabelForValue('board_philosophy', p.board_philosophy) || '—',
  },
  {
    label: 'Brand attitude',
    stepIndex: 8,
    getValue: p => getLabelForValue('brand_attitude', p.brand_attitude) || '—',
  },
  {
    label: 'Complexity',
    stepIndex: 9,
    getValue: p => getLabelForValue('complexity_tolerance', p.complexity_tolerance) || '—',
  },
  {
    label: 'Budget',
    stepIndex: 10,
    getValue: p => getLabelForValue('budget_range', p.budget_range) || '—',
  },
  {
    label: 'The chase',
    stepIndex: 11,
    getValue: p => p.tone_chase || '—',
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  profile: FullExpertProfile;
  onComplete: (profile: FullExpertProfile) => void;
  onDismiss: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ToneProfileEditor({ profile, onComplete, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const [localProfile, setLocalProfile] = useState<FullExpertProfile>(profile);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  // Local input state for edit mode
  const [localMultiSelect, setLocalMultiSelect] = useState<string[]>([]);
  const [localText, setLocalText] = useState('');
  const [singleDetailText, setSingleDetailText] = useState('');
  const [combinedSelections, setCombinedSelections] = useState<Record<string, string>>({});
  const [combinedTextValues, setCombinedTextValues] = useState<Record<string, string>>({});

  // ── Open a step for editing ───────────────────────────────────────────────

  const openEditStep = (stepIndex: number) => {
    Haptics.selectionAsync();
    const step = STEPS[stepIndex];
    if (step.type === 'single' && step.detailField) {
      setSingleDetailText((localProfile[step.detailField] as string) ?? '');
    } else if (step.type === 'multiselect') {
      setLocalMultiSelect((localProfile[step.field] as string[]) ?? []);
    } else if (step.type === 'freetext') {
      setLocalText((localProfile[step.field] as string) ?? '');
    } else if (step.type === 'combined') {
      const init: Record<string, string> = {};
      const textInit: Record<string, string> = {};
      for (const part of step.parts) {
        const val = (localProfile[part.field] as string) ?? '';
        if (val) init[part.field as string] = val;
        if (part.detailField) {
          textInit[part.detailField as string] = (localProfile[part.detailField] as string) ?? '';
        }
      }
      setCombinedSelections(init);
      setCombinedTextValues(textInit);
    }
    setEditingStepIndex(stepIndex);
  };

  // ── Commit a single step's answer — saves to Supabase immediately ────────

  const commitStep = (updates: Partial<FullExpertProfile>) => {
    const now = new Date();
    const refreshDate = new Date(now);
    refreshDate.setMonth(refreshDate.getMonth() + 6);
    const updated: FullExpertProfile = {
      ...localProfile,
      ...updates,
      profile_updated_at: now.toISOString(),
      profile_refresh_due_at: refreshDate.toISOString(),
    };
    setLocalProfile(updated);
    setEditingStepIndex(null);
    onComplete(updated); // persists to Supabase in the background
  };

  // ─── Edit step renderers ──────────────────────────────────────────────────

  const renderSingleEdit = (s: Extract<StepConfig, { type: 'single' }>) => {
    const hasDetail = Boolean(s.detailField);
    return (
      <View>
        <View style={styles.optionList}>
          {s.options.map(opt => {
            const selected = (localProfile[s.field] as string) === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionBtn, selected && styles.optionBtnSelected]}
                onPress={() => {
                  Haptics.selectionAsync();
                  if (hasDetail) {
                    // Don't auto-save — wait for the Save button
                    setLocalProfile(prev => ({ ...prev, [s.field]: opt.value }));
                  } else {
                    commitStep({ [s.field]: opt.value });
                  }
                }}
                activeOpacity={0.75}
              >
                <Text style={[styles.optionBtnText, selected && styles.optionBtnTextSelected]}>
                  {opt.label}
                </Text>
                {selected && <Ionicons name="checkmark" size={16} color={colors.teal} />}
              </TouchableOpacity>
            );
          })}
        </View>
        {hasDetail && (
          <View style={styles.combinedDetailWrap}>
            {s.detailLabel && (
              <Text style={styles.combinedDetailLabel}>{s.detailLabel}</Text>
            )}
            <TextInput
              style={styles.combinedDetailInput}
              value={singleDetailText}
              onChangeText={text => setSingleDetailText(text)}
              placeholder={s.detailPlaceholder ?? ''}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={4}
              returnKeyType="done"
              blurOnSubmit
            />
          </View>
        )}
      </View>
    );
  };

  const renderMultiEdit = (s: Extract<StepConfig, { type: 'multiselect' }>) => {
    const atMax = s.maxSelect !== undefined && localMultiSelect.length >= s.maxSelect;
    return (
      <>
        <View style={styles.chipGrid}>
          {s.options.map(opt => {
            const sel = localMultiSelect.includes(opt.value);
            const dimmed = atMax && !sel;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chip, sel && styles.chipSelected, dimmed && styles.chipDimmed]}
                onPress={() => {
                  if (dimmed) return;
                  Haptics.selectionAsync();
                  setLocalMultiSelect(prev =>
                    prev.includes(opt.value) ? prev.filter(v => v !== opt.value) : [...prev, opt.value]
                  );
                }}
                activeOpacity={dimmed ? 1 : 0.75}
              >
                <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.continueBtn, localMultiSelect.length === 0 && styles.continueBtnDisabled]}
          onPress={() => localMultiSelect.length > 0 && commitStep({ [s.field]: localMultiSelect })}
          disabled={localMultiSelect.length === 0}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>
            Save{localMultiSelect.length > 0 ? ` (${localMultiSelect.length} selected)` : ''}
          </Text>
        </TouchableOpacity>
      </>
    );
  };

  const renderFreeTextEdit = (s: Extract<StepConfig, { type: 'freetext' }>) => (
    <View>
      <TextInput
        style={styles.textInput}
        value={localText}
        onChangeText={setLocalText}
        placeholder={s.placeholder}
        placeholderTextColor={colors.textMuted}
        multiline
        maxLength={300}
        autoFocus
        returnKeyType="done"
        blurOnSubmit
      />
      <View style={styles.textActions}>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={() => commitStep({ [s.field]: localText.trim() })}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={() => commitStep({ [s.field]: '' })}
          activeOpacity={0.7}
        >
          <Text style={styles.clearBtnText}>Clear answer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderCombinedEdit = (s: Extract<StepConfig, { type: 'combined' }>) => {
    const allAnswered = s.parts.every(p => Boolean(combinedSelections[p.field as string]));
    return (
      <View>
        {s.parts.map((part, i) => (
          <View key={i} style={styles.combinedPart}>
            <Text style={styles.combinedPartLabel}>{part.label}</Text>
            <View style={styles.optionListCompact}>
              {part.options.map(opt => {
                const sel = combinedSelections[part.field as string] === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.optionBtnCompact, sel && styles.optionBtnSelected]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setCombinedSelections(prev => ({ ...prev, [part.field as string]: opt.value }));
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.optionBtnTextCompact, sel && styles.optionBtnTextSelected]}>
                      {opt.label}
                    </Text>
                    {sel && <Ionicons name="checkmark" size={14} color={colors.teal} />}
                  </TouchableOpacity>
                );
              })}
            </View>
            {part.detailField && (
              <View style={styles.combinedDetailWrap}>
                {part.detailLabel && (
                  <Text style={styles.combinedDetailLabel}>{part.detailLabel}</Text>
                )}
                <TextInput
                  style={styles.combinedDetailInput}
                  value={combinedTextValues[part.detailField as string] ?? ''}
                  onChangeText={text =>
                    setCombinedTextValues(prev => ({ ...prev, [part.detailField as string]: text }))
                  }
                  placeholder={part.detailPlaceholder ?? ''}
                  placeholderTextColor={colors.textMuted}
                  maxLength={120}
                  returnKeyType="done"
                  blurOnSubmit
                />
              </View>
            )}
          </View>
        ))}
        <TouchableOpacity
          style={[styles.continueBtn, !allAnswered && styles.continueBtnDisabled]}
          onPress={() => {
            if (!allAnswered) return;
            const updates: Partial<FullExpertProfile> = {};
            for (const part of s.parts) {
              (updates as Record<string, unknown>)[part.field as string] =
                combinedSelections[part.field as string] ?? '';
              if (part.detailField) {
                (updates as Record<string, unknown>)[part.detailField as string] =
                  combinedTextValues[part.detailField as string] ?? '';
              }
            }
            commitStep(updates);
          }}
          disabled={!allAnswered}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Save</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Pinned Save button for single+detail steps — floats above keyboard (outside ScrollView)
  const renderBottomAction = (step: Extract<StepConfig, { type: 'single' }>) => {
    if (!step.detailField) return null;
    const isReady = Boolean(localProfile[step.field]) || singleDetailText.length === 4;
    return (
      <View style={[styles.bottomActionBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TouchableOpacity
          style={[styles.continueBtn, !isReady && styles.continueBtnDisabled]}
          onPress={() => {
            if (!isReady) return;
            commitStep({ [step.field]: localProfile[step.field] ?? '', [step.detailField as string]: singleDetailText.trim() });
          }}
          disabled={!isReady}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Save</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ─── Edit screen ──────────────────────────────────────────────────────────

  if (editingStepIndex !== null) {
    const step = STEPS[editingStepIndex];
    return (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.screenHeader}>
          <TouchableOpacity
            style={styles.editBackBtn}
            onPress={() => setEditingStepIndex(null)}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
            <Text style={styles.editBackText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.editHeaderTitle}>Edit Answer</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.questionCard}>
            <Text style={styles.questionText}>{step.question}</Text>
            {step.subtitle && (
              <Text style={styles.questionSubtitle}>{step.subtitle}</Text>
            )}
          </View>

          {step.type === 'single' && renderSingleEdit(step)}
          {step.type === 'multiselect' && renderMultiEdit(step)}
          {step.type === 'freetext' && renderFreeTextEdit(step)}
          {step.type === 'combined' && renderCombinedEdit(step)}
        </ScrollView>

        {step.type === 'single' && renderBottomAction(step)}
      </KeyboardAvoidingView>
    );
  }

  // ─── Summary screen ───────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.screenHeader}>
        <TouchableOpacity
          style={styles.editBackBtn}
          onPress={onDismiss}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text style={styles.editBackText}>Done</Text>
        </TouchableOpacity>
        <Text style={styles.editHeaderTitle}>Tone Profile</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.summaryNote}>
          Tap any answer to update it. Your profile powers Custom Shop — expertly-curated recommendations built around your sound.
        </Text>

        <View style={styles.summaryCard}>
          {PROFILE_ROWS.map((row, idx) => {
            const value = row.getValue(localProfile);
            const isLast = idx === PROFILE_ROWS.length - 1;
            const isEmpty = value === '—';
            return (
              <React.Fragment key={row.label}>
                <TouchableOpacity
                  style={styles.summaryRow}
                  onPress={() => openEditStep(row.stepIndex)}
                  activeOpacity={0.7}
                >
                  <View style={styles.summaryRowInner}>
                    <Text style={styles.summaryLabel}>{row.label}</Text>
                    <Text
                      style={[styles.summaryValue, isEmpty && styles.summaryValueEmpty]}
                      numberOfLines={2}
                    >
                      {value}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
                {!isLast && <View style={styles.summaryDivider} />}
              </React.Fragment>
            );
          })}
        </View>
      </ScrollView>

    </View>
  );
}

export default ToneProfileEditor;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Shared screen header (edit + summary)
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  editBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    width: 60,
  },
  editBackText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
  },
  editHeaderTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.base,
    gap: spacing.lg,
  },

  // Question card (edit mode)
  questionCard: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  questionText: {
    fontSize: 24,
    fontFamily: typography.display,
    color: colors.textPrimary,
    lineHeight: 32,
  },
  questionSubtitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 22,
  },

  // Single select
  optionList: { gap: spacing.sm },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
  },
  optionBtnSelected: {
    borderColor: colors.teal,
    backgroundColor: colors.teal + '12',
  },
  optionBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  optionBtnTextSelected: { color: colors.teal },

  // Compact options (combined)
  optionListCompact: { gap: spacing.xs },
  optionBtnCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  optionBtnTextCompact: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },

  // Multi-select chips
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chipSelected: {
    backgroundColor: colors.teal + '18',
    borderColor: colors.teal,
  },
  chipDimmed: { opacity: 0.4 },
  chipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  chipTextSelected: { color: colors.teal },

  // Free text
  textInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: spacing.lg,
  },
  textActions: { gap: spacing.sm },
  clearBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  clearBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },

  // Pinned bottom action bar (outside ScrollView — floats above keyboard)
  bottomActionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Continue / save button
  continueBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.xl,
    paddingVertical: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnDisabled: { backgroundColor: colors.border },
  continueBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },

  // Combined screen
  combinedPart: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  combinedPartLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  combinedDetailWrap: {
    marginTop: spacing.sm,
    gap: 6,
  },
  combinedDetailLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  combinedDetailInput: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },

  // Summary screen
  summaryNote: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
  },
  summaryRowInner: {
    flex: 1,
    gap: 3,
  },
  summaryLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  summaryValueEmpty: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.base,
  },

});
