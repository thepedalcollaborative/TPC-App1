import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Session } from '@supabase/supabase-js';
import { colors, typography, spacing, radius, gradients, categoryColors, boardColorOptions, boardColorMap } from '../theme';
import { useStore } from '../hooks/useStore';
import { supabase, Board } from '../lib/supabase';
import { EmptyState } from '../components';
import { BoardsStackParamList } from '../types/navigation';
import { boardCreationAllowed, FREE_BOARDS_LIMIT, hasBetaFullAccess } from '../lib/subscription';
import { SwipeDismissSheet } from '../components/SwipeDismissSheet';

const BOARD_EMOJIS = ['🎸', '🎶', '🎵', '🎛', '🔊', '⚡'];

export default function BoardsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<BoardsStackParamList>>();
  const { session, boards, fetchBoards, profile, openPaywall } = useStore();
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [boardImageUrls, setBoardImageUrls] = useState<Record<string, string>>({});

  const isPro = Boolean(profile?.is_premium) || hasBetaFullAccess();

  const handleNewBoardPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!boardCreationAllowed(isPro, boards.length)) {
      openPaywall('boards');
      return;
    }
    setShowNewBoard(true);
  };

  const handleDelete = (board: Board) => {
    Alert.alert(
      'Delete Board',
      `Delete "${board.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!session?.user?.id) {
              Alert.alert('Session expired', 'Please sign in again.');
              return;
            }
            const { error, data: deleted } = await supabase
              .from('boards')
              .delete()
              .eq('id', board.id)
              .eq('user_id', session.user.id)
              .select('id');
            if (error) {
              Alert.alert('Delete failed', error.message);
              return;
            }
            if (!deleted?.length) {
              Alert.alert('Delete failed', 'Could not confirm deletion for this account.');
              return;
            }
            useStore.setState((s) => ({
              boards: s.boards.filter((b) => b.id !== board.id),
            }));
            fetchBoards();
          },
        },
      ]
    );
  };

  useEffect(() => {
    let mounted = true;
    const loadBoardImages = async () => {
      const withImages = boards.filter(b => b.board_image_path);
      if (withImages.length === 0) {
        if (mounted) setBoardImageUrls({});
        return;
      }
      const pairs = await Promise.all(
        withImages.map(async b => {
          const { data } = await supabase.storage
            .from('user-pedal-photos')
            .createSignedUrl(b.board_image_path as string, 60 * 60 * 24 * 7);
          return [b.id, data?.signedUrl ?? ''] as const;
        })
      );
      if (!mounted) return;
      const next: Record<string, string> = {};
      for (const [id, url] of pairs) {
        if (url) next[id] = url;
      }
      setBoardImageUrls(next);
    };
    loadBoardImages();
    return () => {
      mounted = false;
    };
  }, [boards]);

  const renderBoard = ({ item }: { item: Board }) => {
    const slots = item.slots ?? [];
    const slotCount = slots.length;
    const previewSlots = slots.slice(0, 6);
    const boardColor = boardColorMap[item.color ?? 'teal'] ?? colors.teal;

    return (
      <TouchableOpacity
        style={styles.boardCard}
        activeOpacity={0.75}
        onPress={() => {
          Haptics.selectionAsync();
          navigation.navigate('BoardDetail', { boardId: item.id });
        }}
        onLongPress={() => handleDelete(item)}
      >
        {/* Header gradient */}
        <LinearGradient colors={['#3D5261', '#2A3E4E']} style={styles.boardCardHeader}>
          {boardImageUrls[item.id] ? (
            <>
              <Image
                source={{ uri: boardImageUrls[item.id] }}
                style={styles.boardCardImage}
                resizeMode="cover"
              />
              <View style={styles.boardCardImageOverlay} />
            </>
          ) : null}
          <View style={styles.boardCardEmojiRow}>
            <View style={[styles.boardColorDot, { backgroundColor: boardColor }]} />
            {previewSlots.map((slot, i) => {
              const color = categoryColors[slot.pedal?.category ?? ''] ?? colors.textMuted;
              return (
                <View
                  key={i}
                  style={[styles.slotDot, { backgroundColor: color }]}
                />
              );
            })}
            {slotCount === 0 && (
              <Text style={styles.emptySlotText}>No pedals</Text>
            )}
            {slotCount > 6 && (
              <Text style={styles.moreSlots}>+{slotCount - 6}</Text>
            )}
          </View>
        </LinearGradient>

        {/* Footer */}
        <View style={styles.boardCardBody}>
          <View style={styles.boardCardInfo}>
            <Text style={styles.boardName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.boardCount}>
              {slotCount} pedal{slotCount !== 1 ? 's' : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <LinearGradient colors={gradients.header} style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Boards</Text>
        </View>
      </LinearGradient>

      {/* ── Grid ── */}
      <FlatList
        data={boards}
        keyExtractor={item => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.gridRow}
        showsVerticalScrollIndicator={false}
        renderItem={renderBoard}
        ListEmptyComponent={
          <EmptyState
            icon="grid-outline"
            title="No boards yet"
            subtitle="Create your first pedalboard to organize your setup"
            action="Create Board"
            onAction={handleNewBoardPress}
          />
        }
      />

      {/* ── Add Board pill ── */}
      <View style={styles.addBoardBar}>
        <TouchableOpacity style={styles.addBoardPill} onPress={handleNewBoardPress} activeOpacity={0.8}>
          <LinearGradient colors={gradients.teal} style={styles.addBoardPillGrad}>
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={styles.addBoardPillText}>Add a Board</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ── New Board Modal ── */}
      <NewBoardModal
        visible={showNewBoard}
        onClose={() => setShowNewBoard(false)}
        onCreated={() => {
          setShowNewBoard(false);
          fetchBoards();
        }}
        session={session}
      />
    </View>
  );
}

// ─── NewBoardModal ────────────────────────────────────────────────────────────
type NewBoardModalProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  session: Session | null;
};

function NewBoardModal({ visible, onClose, onCreated, session }: NewBoardModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [colorKey, setColorKey] = useState('teal');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) { setError('Board name is required.'); return; }
    if (!session) return;
    setIsCreating(true);
    setError('');

    const { error: err } = await supabase.from('boards').insert({
      user_id: session.user.id,
      name: name.trim(),
      description: description.trim() || null,
      color: colorKey,
    });

    setIsCreating(false);
    if (err) {
      setError(err.message);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCreated();
      setName('');
      setDescription('');
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setError('');
    setColorKey('teal');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.modalBackdrop} onPress={handleClose} activeOpacity={1} />
        <SwipeDismissSheet style={styles.modalSheet} onDismiss={handleClose}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Board</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalForm}>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Board Name *</Text>
              <TextInput
                style={styles.formInput}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Main Stage Board"
                placeholderTextColor={colors.textMuted}
                autoFocus
                maxLength={40}
              />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Color</Text>
              <View style={styles.colorPickerRow}>
                {boardColorOptions.map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setColorKey(opt.key)}
                    activeOpacity={0.8}
                    style={[
                      styles.colorDotWrap,
                      colorKey === opt.key && styles.colorDotWrapActive,
                    ]}
                  >
                    <View style={[styles.colorDot, { backgroundColor: opt.color }]} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.formInput, styles.formInputMulti]}
                value={description}
                onChangeText={setDescription}
                placeholder="What's this board for?"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={120}
              />
            </View>

            {error ? <Text style={styles.formError}>{error}</Text> : null}

            <TouchableOpacity
              onPress={handleCreate}
              disabled={isCreating || !name.trim()}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={name.trim() ? gradients.teal : ['#E2DDD7', '#E2DDD7']}
                style={styles.createBtn}
              >
                {isCreating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.createBtnText}>Create Board</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </SwipeDismissSheet>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
    paddingTop: spacing.xs,
  },
  addBoardBar: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  addBoardPill: {
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  addBoardPillGrad: {
    borderRadius: radius.xl,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  addBoardPillText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  // Grid
  grid: {
    padding: spacing.base,
    paddingBottom: spacing.sm,
  },
  gridRow: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  boardCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    minHeight: 140,
  },
  boardCardHeader: {
    height: 80,
    padding: spacing.md,
    justifyContent: 'center',
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
    backgroundColor: 'rgba(20,28,36,0.45)',
  },
  boardCardEmojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    alignItems: 'center',
  },
  boardColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  slotDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    opacity: 0.85,
  },
  emptySlotText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  moreSlots: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  boardCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  boardCardInfo: {
    flex: 1,
  },
  boardName: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  boardCount: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: 2,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingBottom: 48,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  modalForm: {
    gap: spacing.base,
  },
  formField: {
    gap: spacing.sm,
  },
  colorPickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  colorDotWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  colorDotWrapActive: {
    borderColor: colors.textPrimary,
  },
  colorDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  formLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  formInput: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    minHeight: 48,
  },
  formInputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  formError: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.error,
    textAlign: 'center',
  },
  createBtn: {
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
});
