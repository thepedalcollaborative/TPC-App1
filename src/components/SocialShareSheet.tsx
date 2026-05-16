/**
 * SocialShareSheet
 *
 * A bottom-sheet modal with platform-specific share buttons.
 *
 * Usage:
 *   const [shareOpen, setShareOpen] = useState(false);
 *
 *   <SocialShareSheet
 *     visible={shareOpen}
 *     onClose={() => setShareOpen(false)}
 *     text="My GAS list has 12 pedals 🔥 ..."
 *     xText="12 pedals on my GAS list 🔥"          // optional — short for X
 *     onImageShare={() => triggerShare({ type: 'milestone', ... })}  // optional
 *   />
 *
 * Instagram / TikTok → calls onImageShare() which captures the branded card
 *                       and opens the native share sheet (both apps appear there)
 * X (Twitter)        → opens twitter.com intent URL with pre-filled text
 * Facebook           → opens facebook.com sharer with TPC app link
 * More               → native Share.share() text sheet
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Share,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, typography, spacing, radius } from '../theme';
import { SwipeDismissSheet } from './SwipeDismissSheet';

const APP_URL = 'https://thepedalcollaborative.com';

// ─── Platform config ──────────────────────────────────────────────────────────

const PLATFORMS = [
  {
    id:    'instagram',
    label: 'Instagram',
    icon:  'logo-instagram' as const,
    color: '#E1306C',
    bg:    '#FDF0F5',
  },
  {
    id:    'tiktok',
    label: 'TikTok',
    icon:  'logo-tiktok' as const,
    color: '#010101',
    bg:    '#F0F0F0',
  },
  {
    id:    'x',
    label: 'X',
    icon:  'logo-twitter' as const,
    color: '#000000',
    bg:    '#F0F0F0',
  },
  {
    id:    'facebook',
    label: 'Facebook',
    icon:  'logo-facebook' as const,
    color: '#1877F2',
    bg:    '#EEF4FF',
  },
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  visible:       boolean;
  onClose:       () => void;
  /** Full share text used for Facebook, More, and X fallback */
  text:          string;
  /** Optional shorter text for X (≤280 chars). Falls back to `text`. */
  xText?:        string;
  /**
   * Called when the user picks Instagram or TikTok.
   * Should capture the branded image card and open the native share sheet.
   * If omitted, falls back to text share for those platforms.
   */
  onImageShare?: () => void | Promise<void>;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SocialShareSheet({
  visible,
  onClose,
  text,
  xText,
  onImageShare,
}: Props) {
  const insets = useSafeAreaInsets();

  const handlePlatform = async (id: typeof PLATFORMS[number]['id']) => {
    Haptics.selectionAsync();

    switch (id) {
      case 'instagram':
      case 'tiktok': {
        // Close sheet first so the image capture + native share sheet
        // appear cleanly without our modal behind it.
        onClose();
        // Small delay lets the modal animate out before the system sheet appears
        await new Promise(r => setTimeout(r, 300));
        if (onImageShare) {
          await onImageShare();
        } else {
          // No image — fall back to text
          Share.share({ message: text }).catch(() => {});
        }
        break;
      }

      case 'x': {
        const shareText = xText ?? text;
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
        onClose();
        Linking.openURL(url).catch(() => {});
        break;
      }

      case 'facebook': {
        const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(APP_URL)}`;
        onClose();
        Linking.openURL(url).catch(() => {});
        break;
      }
    }
  };

  const handleMore = () => {
    onClose();
    setTimeout(() => {
      Share.share({ message: text }).catch(() => {});
    }, 300);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />

      {/* Sheet */}
      <SwipeDismissSheet style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onDismiss={onClose}>

        <Text style={styles.title}>Share to</Text>

        {/* Platform buttons */}
        <View style={styles.platformRow}>
          {PLATFORMS.map(p => (
            <TouchableOpacity
              key={p.id}
              style={styles.platformBtn}
              onPress={() => handlePlatform(p.id)}
              activeOpacity={0.75}
            >
              <View style={[styles.platformIcon, { backgroundColor: p.bg }]}>
                <Ionicons name={p.icon} size={26} color={p.color} />
              </View>
              <Text style={styles.platformLabel}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* More options */}
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={handleMore}
          activeOpacity={0.8}
        >
          <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.moreText}>More options</Text>
        </TouchableOpacity>

        {/* Cancel */}
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </SwipeDismissSheet>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius:  radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    // Subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    letterSpacing: 0.3,
  },

  // Platform grid
  platformRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.xl,
  },
  platformBtn: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  platformIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },

  // More
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  moreText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },

  // Cancel
  cancelBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
});
