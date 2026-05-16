import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Image,
  Keyboard,
  PanResponder,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients, categoryColors, boardColorOptions } from '../theme';
import { HiddenShareCard } from '../components/ShareCard';
import { useShareCard } from '../lib/useShareCard';
import { useStore } from '../hooks/useStore';
import { supabase, BoardSlot, UserPedal } from '../lib/supabase';
import { CategoryBadge, SocialShareSheet } from '../components';
import { SwipeDismissSheet } from '../components/SwipeDismissSheet';
import { BoardsStackParamList } from '../types/navigation';

type RouteProps = RouteProp<BoardsStackParamList, 'BoardDetail'>;

export default function BoardDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProps>();
  const { boardId } = route.params;

  const { cardRef: boardCardRef, cardData: boardCardData, triggerShare: triggerBoardShare } = useShareCard();
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const { session, boards, ownedPedals, fetchBoards } = useStore();
  const board = boards.find(b => b.id === boardId);
  const slots = board?.slots ?? [];
  const occupiedPedalIds = useMemo(() => {
    const set = new Set<string>();
    for (const b of boards) {
      for (const slot of b.slots ?? []) {
        if (slot.pedal_id) set.add(slot.pedal_id);
      }
    }
    return Array.from(set);
  }, [boards]);

  const sortedSlots = useMemo(
    () => slots.slice().sort((a, b) => a.position - b.position),
    [slots],
  );

  const [showAddPedal, setShowAddPedal] = useState(false);
  const [updatingColor, setUpdatingColor] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Track keyboard visibility so modal-close handlers can wait for keyboardDidHide
  const kbVisibleRef = useRef(false);
  useEffect(() => {
    const s = Keyboard.addListener('keyboardWillShow', () => { kbVisibleRef.current = true; });
    const h = Keyboard.addListener('keyboardDidHide',  () => { kbVisibleRef.current = false; });
    return () => { s.remove(); h.remove(); };
  }, []);

  const closeEditingName = () => {
    const doClose = () => setEditingName(false);
    if (kbVisibleRef.current) {
      Keyboard.dismiss();
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        hideSub.remove();
        clearTimeout(fallback);
        doClose();
      };
      const hideSub = Keyboard.addListener('keyboardDidHide', settle);
      const fallback = setTimeout(settle, 500);
    } else {
      doClose();
    }
  };
  const [boardImageUrl, setBoardImageUrl] = useState<string | null>(null);
  const [uploadingBoardPhoto, setUploadingBoardPhoto] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadBoardImage = async () => {
      if (!board?.board_image_path) {
        if (mounted) setBoardImageUrl(null);
        return;
      }
      const { data } = await supabase.storage
        .from('user-pedal-photos')
        .createSignedUrl(board.board_image_path, 60 * 60 * 24 * 7);
      if (mounted) setBoardImageUrl(data?.signedUrl ?? null);
    };
    loadBoardImage();
    return () => {
      mounted = false;
    };
  }, [board?.id, board?.board_image_path]);

  const handleColorChange = async (colorKey: string) => {
    if (!board || updatingColor) return;
    setUpdatingColor(true);
    await supabase.from('boards').update({ color: colorKey }).eq('id', board.id);
    await fetchBoards();
    setUpdatingColor(false);
  };

  const startEditName = () => {
    if (!board) return;
    setNameDraft(board.name);
    setEditingName(true);
  };

  const saveName = async () => {
    if (!board) return;
    const next = nameDraft.trim();
    if (!next) {
      Alert.alert('Name required', 'Please enter a board name.');
      return;
    }
    setSavingName(true);
    await supabase.from('boards').update({ name: next }).eq('id', board.id);
    await fetchBoards();
    setSavingName(false);
    setEditingName(false);
  };

  const handleRemoveSlot = useCallback((slot: BoardSlot) => {
    Alert.alert(
      'Remove Pedal',
      `Remove ${slot.pedal?.brand} ${slot.pedal?.model} from this board?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('board_slots').delete().eq('id', slot.id);
            fetchBoards();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  }, [fetchBoards]);

  const handleBoardPhoto = async (useCamera: boolean) => {
    if (!board || !session?.user || uploadingBoardPhoto) return;

    if (useCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow camera access to take a board photo.');
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow photo library access to upload a board photo.');
        return;
      }
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.85,
        });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    setUploadingBoardPhoto(true);
    try {
      const asset = result.assets[0];
      const basePath = `${session.user.id}/boards/${board.id}/${Date.now()}`;
      const path = `${basePath}.jpg`;

      const fullAsset = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1400 } }],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
      );
      const fullBuffer = await fetch(fullAsset.uri).then((r) => r.arrayBuffer());

      const { error: uploadError } = await supabase.storage
        .from('user-pedal-photos')
        .upload(path, fullBuffer, {
          upsert: false,
          contentType: 'image/jpeg',
          cacheControl: '31536000',
        });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('boards')
        .update({ board_image_path: path })
        .eq('id', board.id);
      if (updateError) throw updateError;

      const { data } = await supabase.storage
        .from('user-pedal-photos')
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      setBoardImageUrl(data?.signedUrl ?? null);
      await fetchBoards();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not upload board photo. Please try again.';
      Alert.alert('Upload failed', message);
    } finally {
      setUploadingBoardPhoto(false);
    }
  };

  // Optimistic local order — set immediately on drag, cleared after server confirms.
  const [localSlots, setLocalSlots] = useState<typeof sortedSlots | null>(null);
  const displaySlots = localSlots ?? sortedSlots;

  // ── Drag-to-reorder state ─────────────────────────────────────────────────
  const dragActive = useRef(false);
  const dragFromIdx = useRef(-1);
  const dragToIdx = useRef(-1);
  const dragYAnim = useRef(new Animated.Value(0)).current;
  const itemHeightRef = useRef(0); // measured from first rendered slot row
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  // Stable ref so panResponder callbacks always read current displaySlots
  const displaySlotsRef = useRef(displaySlots);
  useEffect(() => { displaySlotsRef.current = displaySlots; }, [displaySlots]);

  const handleSlotLongPress = useCallback((index: number) => {
    dragActive.current = true;
    dragFromIdx.current = index;
    dragToIdx.current = index;
    dragYAnim.setValue(0);
    setDraggingIdx(index);
    setDropIdx(index);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [dragYAnim]);

  // Stable PanResponder — created once so it never gets torn down mid-drag.
  // onMoveShouldSetPanResponder only returns true after a long press has fired,
  // so normal taps and the ScrollView's scroll gesture are unaffected.
  const slotPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => dragActive.current,
      onMoveShouldSetPanResponderCapture: () => dragActive.current,
      onPanResponderMove: (_evt, gs) => {
        dragYAnim.setValue(gs.dy);
        if (!dragActive.current || itemHeightRef.current === 0) return;
        const from = dragFromIdx.current;
        const count = displaySlotsRef.current.length;
        const rawTarget = from + gs.dy / itemHeightRef.current;
        const target = Math.max(0, Math.min(count - 1, Math.round(rawTarget)));
        if (target !== dragToIdx.current) {
          dragToIdx.current = target;
          setDropIdx(target);
          Haptics.selectionAsync();
        }
      },
      onPanResponderRelease: () => {
        if (!dragActive.current) return;
        const from = dragFromIdx.current;
        const to = dragToIdx.current;
        dragActive.current = false;
        dragYAnim.setValue(0);
        setDraggingIdx(null);
        setDropIdx(null);
        if (from !== to && from >= 0 && to >= 0) {
          reorderSlotsRef.current(from, to);
        }
      },
      onPanResponderTerminate: () => {
        dragActive.current = false;
        dragYAnim.setValue(0);
        setDraggingIdx(null);
        setDropIdx(null);
      },
    })
  ).current;
  // ─────────────────────────────────────────────────────────────────────────

  // reorderSlots uses two-phase position updates to avoid the unique constraint
  // on (board_id, position): phase 1 uses negative temps, phase 2 sets finals.
  const reorderSlots = useCallback(
    async (from: number, to: number) => {
      if (from === to) return;
      const current = localSlots ?? sortedSlots;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);

      setLocalSlots(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Phase 1: temp negative positions — no overlap with existing positives
      await Promise.all(
        next.map((slot, i) =>
          supabase.from('board_slots').update({ position: -(i + 1) }).eq('id', slot.id)
        )
      );
      // Phase 2: final positive positions
      const results = await Promise.all(
        next.map((slot, i) =>
          supabase.from('board_slots').update({ position: i + 1 }).eq('id', slot.id).select('id')
        )
      );

      const updatedCount = results.filter(r => (r.data?.length ?? 0) > 0).length;
      if (__DEV__) console.log('[Board] reorderSlots: updated', updatedCount, '/', next.length, 'rows');

      if (updatedCount === next.length) {
        await fetchBoards();
        setLocalSlots(null);
      } else {
        setLocalSlots(null);
        if (updatedCount === 0) {
          Alert.alert('Could not save order', 'The pedal order could not be saved. Please try again.');
        }
      }
    },
    [localSlots, sortedSlots, fetchBoards],
  );
  // Stable ref so the panResponder (created once) can always call the latest reorderSlots
  const reorderSlotsRef = useRef(reorderSlots);
  useEffect(() => { reorderSlotsRef.current = reorderSlots; }, [reorderSlots]);

  if (!board) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.notFound}>Board not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <LinearGradient colors={gradients.header} style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            Haptics.selectionAsync();
            navigation.goBack();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          {boardImageUrl ? (
            <Image source={{ uri: boardImageUrl }} style={styles.boardPreviewImage} resizeMode="cover" />
          ) : null}
          <TouchableOpacity onPress={startEditName} activeOpacity={0.7}>
            <Text style={styles.boardName} numberOfLines={1}>{board.name}</Text>
          </TouchableOpacity>
          {board.description ? (
            <Text style={styles.boardDesc} numberOfLines={2}>{board.description}</Text>
          ) : null}
          <Text style={styles.boardMeta}>
            {slots.length} pedal{slots.length !== 1 ? 's' : ''} on this board
          </Text>
          <View style={styles.colorRow}>
            {boardColorOptions.map(opt => (
              <TouchableOpacity
                key={opt.key}
                onPress={() => handleColorChange(opt.key)}
                activeOpacity={0.8}
                style={[
                  styles.colorDotWrap,
                  (board.color ?? 'teal') === opt.key && styles.colorDotWrapActive,
                ]}
              >
                <View style={[styles.colorDot, { backgroundColor: opt.color }]} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={() =>
              Alert.alert('Board photo', 'Choose a source', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Camera', onPress: () => handleBoardPhoto(true) },
                { text: 'Photo Library', onPress: () => handleBoardPhoto(false) },
              ])
            }
            disabled={uploadingBoardPhoto}
            activeOpacity={0.8}
          >
            {uploadingBoardPhoto ? (
              <ActivityIndicator size="small" color={colors.teal} />
            ) : (
              <Ionicons name="image-outline" size={18} color={colors.teal} />
            )}
          </TouchableOpacity>
          {slots.length > 0 && (
            <TouchableOpacity
              style={styles.shareImgBtn}
              onPress={() => { Haptics.selectionAsync(); setShareSheetOpen(true); }}
              activeOpacity={0.8}
            >
              <Ionicons name="share-social-outline" size={16} color={colors.teal} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setShowAddPedal(true);
            }}
            activeOpacity={0.8}
          >
            <LinearGradient colors={gradients.teal} style={styles.addBtnGrad}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Add Pedal</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* ── Pedals on board ── */}
      {slots.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="layers-outline" size={36} color={colors.teal} />
          </View>
          <Text style={styles.emptyTitle}>No pedals on this board yet</Text>
          <Text style={styles.emptySub}>
            Tap "Add Pedal" to start building your signal chain
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.slotsList}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={draggingIdx === null}
        >
          <Text style={styles.slotsLabel}>SIGNAL CHAIN · HOLD TO REORDER</Text>

          {/* Drag target — panHandlers wrap all slot rows */}
          <View {...slotPanResponder.panHandlers} style={styles.slotsContainer}>
            {displaySlots.map((slot, index) => {
              const pedal = slot.pedal;
              if (!pedal) return null;
              const catColor = categoryColors[pedal.category] ?? colors.textMuted;
              const isDragging = draggingIdx === index;
              const isDropTarget = !isDragging && dropIdx === index && draggingIdx !== null;

              // Compute vertical shift for items displaced by the drag
              let shiftY = 0;
              if (draggingIdx !== null && dropIdx !== null && !isDragging) {
                const itemH = itemHeightRef.current || 88;
                if (draggingIdx < dropIdx && index > draggingIdx && index <= dropIdx) {
                  shiftY = -itemH;   // moving down: items above shift up
                } else if (draggingIdx > dropIdx && index >= dropIdx && index < draggingIdx) {
                  shiftY = itemH;    // moving up: items below shift down
                }
              }

              return (
                <View
                  key={slot.id}
                  style={styles.slotRowWrap}
                  onLayout={index === 0 ? ({ nativeEvent: { layout } }) => {
                    if (itemHeightRef.current === 0) itemHeightRef.current = layout.height;
                  } : undefined}
                >
                  {/* Ghost: floats above the list, follows finger */}
                  {isDragging && (
                    <Animated.View
                      style={[
                        styles.slotRow,
                        styles.slotRowGhost,
                        { position: 'absolute', left: 0, right: 0, transform: [{ translateY: dragYAnim }] },
                      ]}
                    >
                      <View style={styles.slotPosition}>
                        <Text style={styles.slotPositionText}>{index + 1}</Text>
                      </View>
                      <View style={[styles.slotCard, { borderLeftColor: catColor }]}>
                        <View style={styles.slotCardContent}>
                          <View style={styles.slotCardInfo}>
                            <CategoryBadge category={pedal.category} small />
                            <Text style={styles.slotBrand}>{pedal.brand}</Text>
                            <Text style={styles.slotModel}>{pedal.model}</Text>
                            <Text style={styles.slotSubcat}>{pedal.subcategory}</Text>
                          </View>
                          <Ionicons name="reorder-three-outline" size={22} color={colors.teal} />
                        </View>
                      </View>
                    </Animated.View>
                  )}

                  {/* Actual row — invisible while dragging (ghost takes its place) */}
                  <View
                    style={[
                      styles.slotRow,
                      { opacity: isDragging ? 0 : 1, transform: [{ translateY: shiftY }] },
                      isDropTarget && styles.slotRowDropTarget,
                    ]}
                  >
                    <View style={styles.slotPosition}>
                      <Text style={styles.slotPositionText}>{index + 1}</Text>
                    </View>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onLongPress={() => handleSlotLongPress(index)}
                      delayLongPress={350}
                      style={[styles.slotCard, { borderLeftColor: catColor }]}
                    >
                      <View style={styles.slotCardContent}>
                        <View style={styles.slotCardInfo}>
                          <CategoryBadge category={pedal.category} small />
                          <Text style={styles.slotBrand}>{pedal.brand}</Text>
                          <Text style={styles.slotModel}>{pedal.model}</Text>
                          <Text style={styles.slotSubcat}>{pedal.subcategory}</Text>
                        </View>
                        <View style={styles.slotActions}>
                          <Ionicons name="reorder-three-outline" size={20} color={colors.textMuted} />
                          <TouchableOpacity
                            onPress={() => handleRemoveSlot(slot)}
                            style={styles.removeBtn}
                            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                          >
                            <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* ── Add Pedal Modal ── */}
      <AddPedalToBoardModal
        visible={showAddPedal}
        onClose={() => setShowAddPedal(false)}
        onAdded={() => {
          setShowAddPedal(false);
          fetchBoards();
        }}
        ownedPedals={ownedPedals}
        boardId={boardId}
        occupiedPedalIds={occupiedPedalIds}
      />

      {/* ── Edit Board Name Modal ── */}
      <Modal visible={editingName} animationType="slide" transparent onRequestClose={closeEditingName}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <TouchableOpacity style={styles.modalBackdrop} onPress={closeEditingName} activeOpacity={1} />
          <SwipeDismissSheet style={styles.modalSheet} onDismiss={closeEditingName}>
            <TouchableOpacity onPress={closeEditingName} activeOpacity={0.7} style={styles.modalCloseBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Board Name</Text>
            </View>
            <Text style={styles.modalHint}>Update the board name below.</Text>
            <Text style={styles.formLabel}>Board Name *</Text>
            <TextInput
              style={styles.formInput}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Board name"
              placeholderTextColor={colors.textMuted}
              autoFocus
              maxLength={40}
            />
            <TouchableOpacity
              onPress={saveName}
              disabled={savingName || !nameDraft.trim()}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={nameDraft.trim() ? gradients.teal : ['#E2DDD7', '#E2DDD7']}
                style={styles.createBtn}
              >
                {savingName ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.createBtnText}>Save Name</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </SwipeDismissSheet>
        </KeyboardAvoidingView>
      </Modal>
      <HiddenShareCard cardRef={boardCardRef} cardData={boardCardData} />
      {board && (() => {
        const pedals = slots.slice().sort((a, b) => a.position - b.position).filter(s => s.pedal).map(s => ({ brand: s.pedal!.brand, model: s.pedal!.model }));
        const list = pedals.slice(0, 8).map(p => `• ${p.brand} ${p.model}`);
        if (pedals.length > 8) list.push(`+${pedals.length - 8} more`);
        const boardText = [
          `${board.name} 🎸`,
          '',
          ...list,
          '',
          `${pedals.length} pedal${pedals.length !== 1 ? 's' : ''}. Built on TPC — https://thepedalcollaborative.com`,
          '',
          '#guitarpedals #pedalboard #tonehunter',
        ].join('\n');
        return (
          <SocialShareSheet
            visible={shareSheetOpen}
            onClose={() => setShareSheetOpen(false)}
            text={boardText}
            xText={`My board "${board.name}" has ${pedals.length} pedal${pedals.length !== 1 ? 's' : ''} 🎸 #guitarpedals #pedalboard`}
            onImageShare={() => triggerBoardShare({ type: 'board', name: board.name, pedals })}
          />
        );
      })()}
    </View>
  );
}

// ─── AddPedalToBoardModal ─────────────────────────────────────────────────────
type AddPedalToBoardModalProps = {
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
  ownedPedals: UserPedal[];
  boardId: string;
  occupiedPedalIds: string[];
};

function AddPedalToBoardModal({
  visible,
  onClose,
  onAdded,
  ownedPedals,
  boardId,
  occupiedPedalIds,
}: AddPedalToBoardModalProps) {
  const [isAdding, setIsAdding] = useState(false);
  const available = ownedPedals.filter(p => !occupiedPedalIds.includes(p.pedal_id));

  const handleAdd = async (userPedal: UserPedal) => {
    setIsAdding(true);
    const { data: existing } = await supabase
      .from('board_slots')
      .select('position')
      .eq('board_id', boardId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = (existing?.position ?? 0) + 1;

    const { error } = await supabase.from('board_slots').insert({
      board_id: boardId,
      pedal_id: userPedal.pedal_id,
      position: nextPosition,
    });

    setIsAdding(false);
    if (!error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAdded();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <SwipeDismissSheet style={styles.modalSheet} onDismiss={onClose}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.modalCloseBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add to Board</Text>
          </View>

          {available.length === 0 ? (
            <View style={styles.modalEmpty}>
              <Text style={styles.modalEmptyText}>
                All your owned pedals are already on a board, or you haven't added any yet.
              </Text>
            </View>
          ) : (
            <FlatList
              data={available}
              keyExtractor={item => item.id}
              style={styles.modalList}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const pedal = item.pedal;
                if (!pedal) return null;
                return (
                  <TouchableOpacity
                    style={styles.modalPedalRow}
                    onPress={() => handleAdd(item)}
                    disabled={isAdding}
                    activeOpacity={0.75}
                  >
                    <View
                      style={[
                        styles.modalPedalStrip,
                        { backgroundColor: categoryColors[pedal.category] ?? colors.textMuted },
                      ]}
                    />
                    <View style={styles.modalPedalInfo}>
                      <Text style={styles.modalPedalBrand}>{pedal.brand}</Text>
                      <Text style={styles.modalPedalModel}>{pedal.model}</Text>
                    </View>
                    <CategoryBadge category={pedal.category} small />
                    {isAdding ? (
                      <ActivityIndicator size="small" color={colors.teal} />
                    ) : (
                      <Ionicons name="add-circle" size={24} color={colors.teal} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </SwipeDismissSheet>
      </View>
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
    paddingBottom: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    marginTop: spacing.sm,
  },
  headerContent: {
    gap: 3,
  },
  boardPreviewImage: {
    width: '100%',
    height: 74,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  boardName: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  boardDesc: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  boardMeta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  colorRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  colorDotWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
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
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  photoBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.teal + '60',
    backgroundColor: colors.teal + '08',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  shareImgBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.teal + '60',
    backgroundColor: colors.teal + '08',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  addBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  // Slots
  slotsList: {
    padding: spacing.base,
    paddingBottom: 40,
  },
  slotsLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: spacing.base,
  },
  slotsContainer: {
    // No extra style — panHandlers wrapper only
  },
  slotRowWrap: {
    // Outer container whose height is measured for drag position calculation.
    // overflow: visible so the ghost Animated.View can float above siblings.
    overflow: 'visible',
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  slotRowGhost: {
    // Elevated appearance while floating during drag
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 10,
  },
  slotRowDropTarget: {
    // Visual hint on the item that will be displaced by the drop
    opacity: 0.55,
  },
  slotActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  slotPosition: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    marginTop: 10,
    flexShrink: 0,
    zIndex: 1,
  },
  slotPositionText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
  },
  slotCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    overflow: 'hidden',
  },
  slotCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  slotCardInfo: {
    flex: 1,
    gap: 3,
  },
  slotBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  slotModel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  slotSubcat: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  removeBtn: {
    padding: spacing.xs,
  },
  // Empty
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  notFound: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
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
    maxHeight: '70%',
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
  modalCloseBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 10,
    padding: spacing.xs,
  },
  modalHeader: {
    marginBottom: spacing.base,
    paddingRight: spacing.xl,
  },
  modalTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  modalHint: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  formLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
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
    marginBottom: spacing.base,
  },
  modalList: {
    flexGrow: 0,
  },
  modalPedalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalPedalStrip: {
    width: 4,
    height: 40,
    borderRadius: 2,
  },
  modalPedalInfo: {
    flex: 1,
  },
  modalPedalBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  modalPedalModel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    marginTop: 1,
  },
  modalEmpty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
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
