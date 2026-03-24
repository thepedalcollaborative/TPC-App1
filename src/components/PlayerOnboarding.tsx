import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, typography, spacing, radius } from '../theme';
import { FullExpertProfile } from '../lib/supabase';
import { STEPS, TOTAL_STEPS, StepConfig } from '../lib/onboardingSteps';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  onComplete: (profile: FullExpertProfile) => void;
  onDismiss?: () => void;
  initialAnswers?: Partial<FullExpertProfile>;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PlayerOnboarding({ onComplete, onDismiss, initialAnswers }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<FullExpertProfile>>(initialAnswers ?? {});
  // Local input state for multi-select and freetext (committed on Continue)
  const [localMultiSelect, setLocalMultiSelect] = useState<string[]>([]);
  const [localText, setLocalText] = useState('');
  // For single steps with an optional detail field (e.g. Q1 year_started)
  const [singleDetailText, setSingleDetailText] = useState('');
  // For the combined screen (Q5) — option selections and optional free-text detail fields
  const [combinedSelections, setCombinedSelections] = useState<Record<string, string>>({});
  const [combinedTextValues, setCombinedTextValues] = useState<Record<string, string>>({});

  const fadeAnim = useRef(new Animated.Value(1)).current;

  const animateTransition = useCallback((next: () => void) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      next();
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  }, []);

  const currentStep = STEPS[step];

  // ── Initialize local state when step changes ──────────────────────────────
  const initLocalState = useCallback((newStep: number) => {
    const s = STEPS[newStep];
    if (!s) return;

    if (s.type === 'single' && s.detailField) {
      setSingleDetailText((answers[s.detailField] as string | undefined) ?? '');
    } else if (s.type === 'multiselect') {
      const existing = (answers[s.field] as string[] | undefined) ?? [];
      setLocalMultiSelect(existing);
    } else if (s.type === 'freetext') {
      const existing = (answers[s.field] as string | undefined) ?? '';
      setLocalText(existing);
    } else if (s.type === 'combined') {
      const init: Record<string, string> = {};
      const textInit: Record<string, string> = {};
      for (const part of s.parts) {
        const val = (answers[part.field] as string | undefined) ?? '';
        if (val) init[part.field as string] = val;
        if (part.detailField) {
          textInit[part.detailField as string] = (answers[part.detailField] as string | undefined) ?? '';
        }
      }
      setCombinedSelections(init);
      setCombinedTextValues(textInit);
    }
  }, [answers]);

  const goToStep = useCallback((newStep: number) => {
    animateTransition(() => {
      initLocalState(newStep);
      setStep(newStep);
    });
  }, [animateTransition, initLocalState]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSingleSelect = (field: keyof FullExpertProfile, value: string) => {
    Haptics.selectionAsync();
    const updated = { ...answers, [field]: value };
    setAnswers(updated);
    // If this step has a detail field, just highlight the selection — wait for Continue
    const s = currentStep as Extract<StepConfig, { type: 'single' }>;
    if (s.detailField) return;
    animateTransition(() => {
      const nextStep = step + 1;
      if (nextStep < TOTAL_STEPS) {
        initLocalState(nextStep);
        setStep(nextStep);
      } else {
        buildAndComplete(updated);
      }
    });
  };

  const handleSingleWithDetailContinue = () => {
    Haptics.selectionAsync();
    const s = currentStep as Extract<StepConfig, { type: 'single' }>;
    if (!s.detailField) return;
    const updated = { ...answers, [s.detailField]: singleDetailText.trim() };
    setAnswers(updated);
    advanceOrComplete(updated);
  };

  const handleMultiToggle = (value: string, maxSelect?: number) => {
    Haptics.selectionAsync();
    setLocalMultiSelect(prev => {
      if (prev.includes(value)) return prev.filter(v => v !== value);
      if (maxSelect !== undefined && prev.length >= maxSelect) return prev; // cap reached
      return [...prev, value];
    });
  };

  const handleMultiContinue = () => {
    if (localMultiSelect.length === 0) return;
    Haptics.selectionAsync();
    const s = currentStep as Extract<StepConfig, { type: 'multiselect' }>;
    const updated = { ...answers, [s.field]: localMultiSelect };
    setAnswers(updated);
    advanceOrComplete(updated);
  };

  const handleTextContinue = () => {
    Haptics.selectionAsync();
    const s = currentStep as Extract<StepConfig, { type: 'freetext' }>;
    const updated = { ...answers, [s.field]: localText.trim() };
    setAnswers(updated);
    advanceOrComplete(updated);
  };

  const handleTextSkip = () => {
    Haptics.selectionAsync();
    const s = currentStep as Extract<StepConfig, { type: 'freetext' }>;
    const updated = { ...answers, [s.field]: '' };
    setAnswers(updated);
    advanceOrComplete(updated);
  };

  const handleCombinedContinue = () => {
    Haptics.selectionAsync();
    const s = currentStep as Extract<StepConfig, { type: 'combined' }>;
    let updated = { ...answers };
    for (const part of s.parts) {
      updated = { ...updated, [part.field]: combinedSelections[part.field as string] ?? '' };
      if (part.detailField) {
        updated = { ...updated, [part.detailField]: combinedTextValues[part.detailField as string] ?? '' };
      }
    }
    setAnswers(updated);
    advanceOrComplete(updated);
  };

  const combinedAllAnswered = () => {
    const s = currentStep;
    if (s.type !== 'combined') return false;
    return s.parts.every(p => Boolean(combinedSelections[p.field as string]));
  };

  const advanceOrComplete = (updated: Partial<FullExpertProfile>) => {
    const nextStep = step + 1;
    if (nextStep < TOTAL_STEPS) {
      animateTransition(() => {
        initLocalState(nextStep);
        setStep(nextStep);
      });
    } else {
      buildAndComplete(updated);
    }
  };

  const buildAndComplete = (finalAnswers: Partial<FullExpertProfile>) => {
    const now = new Date().toISOString();
    const refreshDate = new Date();
    refreshDate.setMonth(refreshDate.getMonth() + 6);

    const profile: FullExpertProfile = {
      experience_years: (finalAnswers.experience_years as string) ?? '',
      year_started: (finalAnswers.year_started as string) ?? '',
      tone_identity: (finalAnswers.tone_identity as string) ?? '',
      guitar_heroes: (finalAnswers.guitar_heroes as string) ?? '',
      sonic_moments: (finalAnswers.sonic_moments as string[]) ?? [],
      guitar_type: (finalAnswers.guitar_type as string) ?? '',
      guitar_details: (finalAnswers.guitar_details as string) ?? '',
      amp_type: (finalAnswers.amp_type as string) ?? '',
      amp_details: (finalAnswers.amp_details as string) ?? '',
      signal_chain: (finalAnswers.signal_chain as string) ?? '',
      genres: (finalAnswers.genres as string[]) ?? [],
      board_philosophy: (finalAnswers.board_philosophy as string) ?? '',
      brand_attitude: (finalAnswers.brand_attitude as string) ?? '',
      complexity_tolerance: (finalAnswers.complexity_tolerance as string) ?? '',
      budget_range: (finalAnswers.budget_range as string) ?? '',
      tone_chase: (finalAnswers.tone_chase as string) ?? '',
      onboarding_completed_at: now,
      profile_updated_at: now,
      profile_refresh_due_at: refreshDate.toISOString(),
    };
    onComplete(profile);
  };

  const handleBack = () => {
    if (step === 0) return;
    goToStep(step - 1);
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderProgress = () => (
    <View style={styles.progressBar}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.progressSegment,
            i < step && styles.progressSegmentDone,
            i === step && styles.progressSegmentActive,
          ]}
        />
      ))}
    </View>
  );

  const renderHeader = () => (
    <View style={styles.headerRow}>
      {step > 0 ? (
        <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.backBtn} />
      )}
      <Text style={styles.stepLabel}>{step + 1} of {TOTAL_STEPS}</Text>
      {step === 0 && onDismiss ? (
        <TouchableOpacity onPress={onDismiss} activeOpacity={0.7}>
          <Text style={styles.skipAllText}>Skip for now</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ width: 80 }} />
      )}
    </View>
  );

  const renderSingleSelect = (s: Extract<StepConfig, { type: 'single' }>) => {
    const hasDetail = Boolean(s.detailField);
    return (
      <View>
        <View style={styles.optionList}>
          {s.options.map(opt => {
            const selected = (answers[s.field] as string) === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionBtn, selected && styles.optionBtnSelected]}
                onPress={() => handleSingleSelect(s.field, opt.value)}
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

  const renderMultiSelect = (s: Extract<StepConfig, { type: 'multiselect' }>) => {
    const atMax = s.maxSelect !== undefined && localMultiSelect.length >= s.maxSelect;
    return (
      <>
        <View style={styles.chipGrid}>
          {s.options.map(opt => {
            const selected = localMultiSelect.includes(opt.value);
            const dimmed = atMax && !selected;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.chip,
                  selected && styles.chipSelected,
                  dimmed && styles.chipDimmed,
                ]}
                onPress={() => !dimmed && handleMultiToggle(opt.value, s.maxSelect)}
                activeOpacity={dimmed ? 1 : 0.75}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.continueBtn, localMultiSelect.length === 0 && styles.continueBtnDisabled]}
          onPress={handleMultiContinue}
          activeOpacity={0.85}
          disabled={localMultiSelect.length === 0}
        >
          <Text style={styles.continueBtnText}>
            Continue{localMultiSelect.length > 0 ? ` (${localMultiSelect.length} selected)` : ''}
          </Text>
        </TouchableOpacity>
      </>
    );
  };

  const renderFreeText = (s: Extract<StepConfig, { type: 'freetext' }>) => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TextInput
        style={styles.textInput}
        value={localText}
        onChangeText={setLocalText}
        placeholder={s.placeholder}
        placeholderTextColor={colors.textMuted}
        multiline
        maxLength={300}
        returnKeyType="done"
        blurOnSubmit
      />
      <View style={styles.textActions}>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={handleTextContinue}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={handleTextSkip} activeOpacity={0.7}>
          <Text style={styles.skipBtnText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );

  const renderCombined = (s: Extract<StepConfig, { type: 'combined' }>) => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {s.parts.map((part, partIdx) => (
        <View key={partIdx} style={styles.combinedPart}>
          <Text style={styles.combinedPartLabel}>{part.label}</Text>
          <View style={styles.optionListCompact}>
            {part.options.map(opt => {
              const selected = combinedSelections[part.field as string] === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionBtnCompact, selected && styles.optionBtnSelected]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setCombinedSelections(prev => ({ ...prev, [part.field as string]: opt.value }));
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.optionBtnTextCompact, selected && styles.optionBtnTextSelected]}>
                    {opt.label}
                  </Text>
                  {selected && <Ionicons name="checkmark" size={14} color={colors.teal} />}
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
        style={[styles.continueBtn, !combinedAllAnswered() && styles.continueBtnDisabled]}
        onPress={handleCombinedContinue}
        activeOpacity={0.85}
        disabled={!combinedAllAnswered()}
      >
        <Text style={styles.continueBtnText}>Continue</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );

  const renderStepContent = () => {
    switch (currentStep.type) {
      case 'single':
        return renderSingleSelect(currentStep);
      case 'multiselect':
        return renderMultiSelect(currentStep);
      case 'freetext':
        return renderFreeText(currentStep);
      case 'combined':
        return renderCombined(currentStep);
    }
  };

  // Bottom Continue button — rendered outside ScrollView so it floats above the keyboard
  const renderBottomAction = () => {
    const s = currentStep;
    if (s.type !== 'single' || !s.detailField) return null;
    const isReady = Boolean(answers[s.field]) || singleDetailText.length === 4;
    return (
      <View style={[styles.bottomActionBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TouchableOpacity
          style={[styles.continueBtn, !isReady && styles.continueBtnDisabled]}
          onPress={() => handleSingleWithDetailContinue()}
          disabled={!isReady}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {renderProgress()}
      {renderHeader()}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          {/* Question card */}
          <View style={styles.questionCard}>
            <Text style={styles.questionText}>{currentStep.question}</Text>
            {currentStep.subtitle && (
              <Text style={styles.questionSubtitle}>{currentStep.subtitle}</Text>
            )}
          </View>

          {/* Input area */}
          {renderStepContent()}
        </Animated.View>
      </ScrollView>

      {renderBottomAction()}
    </KeyboardAvoidingView>
  );
}

export default PlayerOnboarding;

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Progress bar
  progressBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.base,
    gap: 4,
    paddingTop: spacing.sm,
  },
  progressSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  progressSegmentDone: {
    backgroundColor: colors.teal + '80',
  },
  progressSegmentActive: {
    backgroundColor: colors.teal,
  },
  // Header row
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  skipAllText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    width: 80,
    textAlign: 'right',
  },
  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.base,
    paddingBottom: 48,
    gap: spacing.lg,
  },
  // Question card
  questionCard: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  questionText: {
    fontSize: 26,
    fontFamily: typography.display,
    color: colors.textPrimary,
    lineHeight: 34,
  },
  questionSubtitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 22,
  },
  // Single select options
  optionList: {
    gap: spacing.sm,
  },
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
  optionBtnTextSelected: {
    color: colors.teal,
  },
  // Compact options (for combined screen)
  optionListCompact: {
    gap: spacing.xs,
  },
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
  chipDimmed: {
    opacity: 0.4,
  },
  chipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: colors.teal,
  },
  // Free text input
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
  textActions: {
    gap: spacing.sm,
  },
  // Pinned bottom action bar (outside ScrollView — floats above keyboard)
  bottomActionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Continue button
  continueBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.xl,
    paddingVertical: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnDisabled: {
    backgroundColor: colors.border,
  },
  continueBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  // Skip button (for free text questions)
  skipBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  skipBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
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
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
});
