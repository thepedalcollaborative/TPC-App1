/**
 * NetworkErrorView
 *
 * Inline error state for sections that load remote data.
 * Replaces the generic "Could not load listings" text string with a
 * properly classified icon + title + message + optional retry button.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing } from '../theme';
import type { ClassifiedError } from '../lib/networkError';

interface Props {
  error: ClassifiedError;
  onRetry?: () => void;
  compact?: boolean;
}

export function NetworkErrorView({ error, onRetry, compact = false }: Props) {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <Ionicons
        name={error.icon as any}
        size={compact ? 18 : 24}
        color={colors.textMuted}
        style={styles.icon}
      />
      <Text style={[styles.title, compact && styles.titleCompact]}>{error.title}</Text>
      <Text style={[styles.message, compact && styles.messageCompact]}>{error.message}</Text>
      {error.retryable && onRetry && (
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.7}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: 6,
  },
  containerCompact: {
    paddingVertical: spacing.md,
    gap: 4,
  },
  icon: {
    marginBottom: 4,
    opacity: 0.6,
  },
  title: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: typography.sizes.sm,
  },
  message: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  messageCompact: {
    fontSize: typography.sizes.xs,
    lineHeight: 16,
  },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
});
