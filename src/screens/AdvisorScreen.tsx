import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Image,
  Linking,
  Modal,
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native'; // kept for future deep-link navigation
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import { useStore } from '../hooks/useStore';
import { askClaude, Message, ContentBlock } from '../lib/anthropic';
import { buildSystemPrompt, STARTER_PROMPTS } from '../lib/systemPrompt';
import { hasBetaFullAccess } from '../lib/subscription';
import { useMessageGate } from '../hooks/useMessageGate';
import { loadMemory, refreshMemory } from '../lib/memory';
import { reverbSearchUrl } from '../lib/reverb';
import {
  invokeEdgeFunction,
  createConversation,
  updateConversation,
  fetchConversation,
  fetchConversations,
  type ConversationMessage,
} from '../lib/supabase';
import { shareAdvisorResponse } from '../lib/share';
import { weeklyPickCountdownLabel } from '../lib/notifications';
import { useRoute, RouteProp } from '@react-navigation/native';
import { AIStackParamList, RootStackParamList } from '../types/navigation';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SwipeDismissSheet } from '../components/SwipeDismissSheet';
import { classifyError } from '../lib/networkError';
import * as Clipboard from 'expo-clipboard';

type ChatMessage = Message & {
  id: string;
  isStreaming?: boolean;
  /** Local image URI for display — only set on user messages that included an image */
  imageUri?: string;
};

const TEAL_GRADIENT: [string, string] = [colors.teal, colors.tealDark];
const SURFACE_GRADIENT: [string, string] = ['#FFFFFF', '#F7F4F0'];

/** Extract text from a message content that may be a string or a ContentBlock array */
const getMessageText = (content: string | ContentBlock[]): string =>
  typeof content === 'string' ? content :
  (content as ContentBlock[]).find(b => b.type === 'text')?.text ?? '';

export default function AdvisorScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<AIStackParamList, 'Advisor'>>();
  const resumeConversationId = route.params?.conversationId;

  const { session, ownedPedals, wishlistPedals, retiredPedals, boards, profile, openPaywall, weeklyPick, weeklyPickLoading, fetchWeeklyPick, addToWishlist } = useStore();

  const isPro = Boolean(profile?.is_premium) || hasBetaFullAccess();
  const { checkGate, gateState } = useMessageGate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);
  const [memory, setMemory] = useState('');
  const [queuedCount, setQueuedCount] = useState(0);
  const [showWeeklyDetail, setShowWeeklyDetail] = useState(false);
  const [weeklyWishlistState, setWeeklyWishlistState] = useState<'idle' | 'loading' | 'added' | 'exists'>('idle');
  const [pendingImage, setPendingImage] = useState<{ uri: string; base64: string } | null>(null);

  // ── Conversation persistence (Pro only) ────────────────────────────────────
  const conversationIdRef = useRef<string | null>(resumeConversationId ?? null);
  const [recentConvTitles, setRecentConvTitles] = useState<string[]>([]);

  // Load resumed conversation whenever conversationId param changes
  useEffect(() => {
    if (!resumeConversationId || !isPro) {
      // Fresh chat — clear any prior conversation ref
      if (!resumeConversationId) conversationIdRef.current = null;
      return;
    }
    conversationIdRef.current = resumeConversationId;
    fetchConversation(resumeConversationId).then(conv => {
      if (!conv) return;
      const loaded: ChatMessage[] = conv.messages.map((m, i) => ({
        id: `loaded-${i}`,
        role: m.role,
        content: m.content,
      }));
      setMessages(loaded);
      setSessionWarning(null);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 100);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeConversationId]);

  // Load recent conversation titles for system-prompt context enrichment (Pro)
  useEffect(() => {
    if (!isPro || !session?.user?.id) return;
    fetchConversations(session.user.id).then(convs => {
      const titles = convs.slice(0, 5).map(c => c.title).filter(Boolean);
      setRecentConvTitles(titles);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, session?.user?.id]);
  // ──────────────────────────────────────────────────────────────────────────
  const memoryRef = useRef('');
  const communitySignalsRef = useRef('');
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const dotAnim = useRef(new Animated.Value(0)).current;
  // Double-submit guard (ref = synchronous, no stale-closure issues)
  const isSubmittingRef = useRef(false);
  // Message queue for sending while a response is in flight
  const messageQueue = useRef<string[]>([]);
  // Stable ref to latest sendMessage — used to drain queue from inside callbacks
  const sendMessageRef = useRef<((text: string) => void) | null>(null);
  // Keep messagesRef current so queue-drain calls build correct history
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Load player memory on mount
  useEffect(() => {
    if (!session?.user?.id) return;
    loadMemory(session.user.id).then(m => {
      setMemory(m);
      memoryRef.current = m;
    });
  }, [session?.user?.id]);

  // Fetch weekly pick when screen mounts (gated inside fetchWeeklyPick for Pro)
  useEffect(() => {
    fetchWeeklyPick();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro]);

  // Fetch community signals on mount (non-blocking, cached for session)
  useEffect(() => {
    const collectionIds = ownedPedals.map(p => p.pedal_id).filter(Boolean);
    invokeEdgeFunction<{ signals: string }>('community-signals', {
      action: 'query',
      collection_pedal_ids: collectionIds,
      gap_categories: [],
      profile_genres: profile?.pedal_expert_profile?.genres ?? [],
      profile_guitar_type: profile?.pedal_expert_profile?.guitar_type ?? '',
    }).then(({ data }) => {
      communitySignalsRef.current = data?.signals ?? '';
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Animate thinking dots
  useEffect(() => {
    if (isThinking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      dotAnim.stopAnimation();
      dotAnim.setValue(0);
    }
  }, [isThinking]);

  // Build system prompt once and only recompute when the user's actual data changes.
  // buildSystemPrompt concatenates ~17KB of static knowledge — memoizing it eliminates
  // that work on every message send.
  const systemPrompt = useMemo(() => buildSystemPrompt(
    ownedPedals,
    wishlistPedals,
    retiredPedals,
    profile?.pedal_expert_profile ?? null,
    boards.length,
    memoryRef.current,
    communitySignalsRef.current,
    isPro ? recentConvTitles : [],   // Pro: enrich AI with past topics
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [
    ownedPedals.length,
    wishlistPedals.length,
    retiredPedals.length,
    boards.length,
    profile?.pedal_expert_profile,
    memory, // triggers re-build after memory loads from Supabase
    recentConvTitles,
  ]);

  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated });
    }, 80);
  }, []);

  const pickImage = useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 },
      async (buttonIndex) => {
        if (buttonIndex === 0) return;
        const useCamera = buttonIndex === 1;
        if (useCamera) {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission needed', 'Please allow camera access in Settings.');
            return;
          }
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission needed', 'Please allow photo library access in Settings.');
            return;
          }
        }
        // Ask the picker for base64 directly — no ImageManipulator or FileSystem needed.
        const result = useCamera
          ? await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.7, base64: true, exif: false })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: false,
              quality: 0.7,
              base64: true,
              exif: false,
            });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        if (!asset.base64) {
          Alert.alert('Could not read image', 'Please try again.');
          return;
        }
        setPendingImage({ uri: asset.uri, base64: asset.base64 });
      }
    );
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // If a response is already in flight, queue this message and return immediately.
    // isSubmittingRef is a synchronous ref so rapid double-taps all see it set.
    if (isSubmittingRef.current) {
      messageQueue.current.push(text.trim());
      setQueuedCount(c => c + 1);
      setInput('');
      Haptics.selectionAsync();
      return;
    }
    isSubmittingRef.current = true;

    // Immediately show the user's bubble and disable the send button.
    // Doing this before the async gate check gives instant visual feedback,
    // preventing impatient re-taps while waiting for the network round-trip.
    const imageSnapshot = pendingImage;
    const messageContent: string | ContentBlock[] = imageSnapshot
      ? [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageSnapshot.base64 } },
          { type: 'text', text: text.trim() || 'What is this?' },
        ]
      : text.trim();
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      imageUri: imageSnapshot?.uri,
    };
    setPendingImage(null);
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsThinking(true);
    scrollToBottom();
    Haptics.selectionAsync();

    // ── Usage gate (server-side) ─────────────────────────────────────────────
    if (!hasBetaFullAccess()) {
      const gate = await checkGate();
      if (!gate.allowed) {
        // Undo the optimistic UI and restore the draft
        setMessages(prev => prev.filter(m => m.id !== userMessage.id));
        setInput(text.trim());
        setIsThinking(false);
        isSubmittingRef.current = false;
        if (gate.error === 'pro_required') {
          openPaywall('advisor');
          return;
        } else if (gate.error === 'messages_depleted') {
          setSessionWarning("You've used all 100 messages this month and have no bonus credits left.");
          return;
        }
        // network_error: fail open — UI restored so user can retry manually
        return;
      }
    }
    setSessionWarning(null);
    // ────────────────────────────────────────────────────────────────────────

    // Build history from the ref so queue-drain calls always get up-to-date context.
    // Keep image content blocks intact so Claude sees the image; only drop base64
    // from older history messages to keep payload size manageable.
    const MAX_HISTORY = 20;
    const allHistory = [...messagesRef.current, userMessage].slice(-MAX_HISTORY);
    const history: Message[] = allHistory.map((m, i) => {
      const isLatest = i === allHistory.length - 1;
      // Strip image blocks from older messages (keep only text) to limit payload size
      if (!isLatest && Array.isArray(m.content)) {
        const text = (m.content as ContentBlock[]).find(b => b.type === 'text')?.text ?? '';
        return { role: m.role, content: text };
      }
      return { role: m.role, content: m.content };
    });

    const assistantId = (Date.now() + 1).toString();
    let accumulated = '';

    setMessages(prev => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ]);

    const drainQueue = () => {
      isSubmittingRef.current = false;
      const next = messageQueue.current.shift();
      if (next) {
        setQueuedCount(c => Math.max(0, c - 1));
        sendMessageRef.current?.(next);
      }
    };

    await askClaude(history, systemPrompt, (chunk) => {
      if (chunk.type === 'text' && chunk.text) {
        accumulated += chunk.text;
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: accumulated, isStreaming: true }
              : m
          )
        );
        scrollToBottom(false);
      } else if (chunk.type === 'done') {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: accumulated, isStreaming: false }
              : m
          )
        );
        setIsThinking(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        scrollToBottom();

        // Background memory refresh — non-blocking
        if (session?.user?.id && accumulated) {
          refreshMemory(session.user.id, memoryRef.current, {
            userMessage: text,
            assistantMessage: accumulated,
          }).catch(() => {});
        }

        // Persist conversation for Pro users (non-blocking)
        if (isPro && session?.user?.id) {
          setMessages(prev => {
            const snapshot: ConversationMessage[] = prev
              .filter(m => !m.isStreaming || getMessageText(m.content).trim())
              .map(m => ({ role: m.role, content: getMessageText(m.content) }));
            if (!conversationIdRef.current) {
              const rawTitle = text.trim().slice(0, 60);
              const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
              createConversation(session.user.id!, title, snapshot)
                .then(id => { conversationIdRef.current = id; })
                .catch(() => {});
            } else {
              updateConversation(conversationIdRef.current, snapshot).catch(() => {});
            }
            return prev;
          });
        }

        drainQueue();
      } else if (chunk.type === 'error') {
        const classified = classifyError(chunk.error);
        const errorContent = classified.type === 'offline'
          ? "You appear to be offline — reconnect and try again."
          : classified.type === 'server'
          ? "Having trouble reaching the server. Try again in a moment."
          : chunk.error ?? 'Something went wrong. Please try again.';
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: errorContent, isStreaming: false }
              : m
          )
        );
        setIsThinking(false);
        drainQueue();
      }
    }, { enableWebSearch: true, maxTokens: 1400 });
  }, [ownedPedals, wishlistPedals, retiredPedals, profile, boards, isPro, openPaywall, scrollToBottom, session, systemPrompt, checkGate]);

  // Keep the ref current so drainQueue can always call the latest version
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  const handleStarterPrompt = (prompt: string) => {
    sendMessage(prompt);
  };

  const isEmpty = messages.length === 0;
  const hasStreamingAssistantWithText = messages.some(
    (m) => m.role === 'assistant' && Boolean(m.isStreaming) && getMessageText(m.content).trim().length > 0
  );

  return (
    <>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <LinearGradient
        colors={['#FFFFFF', '#F7F4F0']}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <View style={styles.headerInner}>
          <View style={styles.advisorIcon}>
            <LinearGradient colors={TEAL_GRADIENT} style={styles.advisorIconGradient}>
              <Ionicons name="sparkles" size={22} color="#fff" />
            </LinearGradient>
            <View style={styles.onlineDot} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>TPC.ai</Text>
            <Text style={styles.headerSub}>
              Powered by Claude · Knows your collection
            </Text>
          </View>
          {/* Pro: new chat + history buttons */}
          {isPro && (
            <View style={styles.headerActions}>
              {messages.length > 0 && (
                <TouchableOpacity
                  style={styles.headerActionBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    conversationIdRef.current = null;
                    setMessages([]);
                    setSessionWarning(null);
                  }}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <Ionicons name="add-circle-outline" size={22} color={colors.teal} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  (navigation as any).navigate('ChatHistory');
                }}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Ionicons name="time-outline" size={22} color={colors.teal} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Collection context pill */}
        <View style={styles.contextPill}>
          <Text style={styles.contextPillText}>
            {ownedPedals.length} owned · {wishlistPedals.length} GAS list{profile?.pedal_expert_profile?.onboarding_completed_at ? ' · tone profile ✓' : ''} · community data ✓
          </Text>
        </View>
      </LinearGradient>

      {/* Message counter — shown once user has sent at least one message */}
      {isPro && !hasBetaFullAccess() && gateState && (
        <View style={styles.counterBar}>
          <Ionicons name="chatbubble-ellipses-outline" size={12} color={colors.textMuted} />
          <Text style={styles.counterText}>
            {gateState.onCredits
              ? `Monthly limit reached · ${gateState.credits} bonus credit${gateState.credits !== 1 ? 's' : ''} remaining`
              : `${gateState.used} of ${gateState.allotment} messages this month${gateState.credits > 0 ? ` · +${gateState.credits} bonus` : ''}`}
          </Text>
        </View>
      )}

      {/* Usage warning banner */}
      {sessionWarning && (
        <TouchableOpacity
          style={styles.warningBanner}
          onPress={() => openPaywall('advisor')}
          activeOpacity={0.85}
        >
          <Ionicons name="sparkles-outline" size={14} color={colors.gold} />
          <Text style={styles.warningText}>{sessionWarning}</Text>
          <Text style={styles.warningCTA}>Get more →</Text>
        </TouchableOpacity>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messages}
        contentContainerStyle={[
          styles.messagesContent,
          isEmpty && styles.messagesContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isEmpty ? (
          <EmptyState
            ownedCount={ownedPedals.length}
            onPromptPress={handleStarterPrompt}
            isPro={isPro}
            weeklyPick={weeklyPick}
            weeklyPickLoading={weeklyPickLoading}
            onWeeklyPickTap={() => { setWeeklyWishlistState('idle'); setShowWeeklyDetail(true); }}
            onCustomShopTap={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); (navigation as any).navigate('Finder'); }}
            onOpenPaywall={() => openPaywall('weekly_pick')}
          />
        ) : (
          <>
            {messages.map((message, idx) => {
              const isLastMsg = idx === messages.length - 1;
              const isCompletedAssistant =
                message.role === 'assistant' &&
                !message.isStreaming &&
                getMessageText(message.content).trim().length > 0;
              const isLastCompleted = isLastMsg && isCompletedAssistant;
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  showShare={isLastCompleted}
                  showCopy={isCompletedAssistant}
                />
              );
            })}
            {isThinking && !hasStreamingAssistantWithText && <ThinkingIndicator dotAnim={dotAnim} />}
          </>
        )}
      </ScrollView>

      {/* Input */}
      <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 8 }]}>
        {queuedCount > 0 && (
          <View style={styles.queueBanner}>
            <Ionicons name="time-outline" size={12} color={colors.teal} />
            <Text style={styles.queueBannerText}>
              {queuedCount} message{queuedCount > 1 ? 's' : ''} queued · sending when ready
            </Text>
          </View>
        )}
        {/* Pending image preview */}
        {pendingImage && (
          <View style={styles.pendingImageRow}>
            <Image source={{ uri: pendingImage.uri }} style={styles.pendingImageThumb} resizeMode="cover" />
            <TouchableOpacity
              style={styles.pendingImageRemove}
              onPress={() => setPendingImage(null)}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputRow}>
          {/* Camera button */}
          <TouchableOpacity
            onPress={pickImage}
            activeOpacity={0.7}
            style={styles.cameraButton}
          >
            <Ionicons name="camera-outline" size={22} color={pendingImage ? colors.teal : colors.textMuted} />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={isThinking ? "Type next message — it'll queue..." : "Ask about tone, a song, your board..."}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            onPress={() => sendMessage(input)}
            disabled={!input.trim() && !pendingImage}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={
                (!input.trim() && !pendingImage)
                  ? ['#E2DDD7', '#E2DDD7']
                  : isThinking
                  ? [colors.gold, colors.goldDark]
                  : TEAL_GRADIENT
              }
              style={styles.sendButton}
            >
              {isThinking && (input.trim() || pendingImage)
                ? <Ionicons name="time-outline" size={20} color="#fff" />
                : <Text style={styles.sendButtonIcon}>↑</Text>
              }
            </LinearGradient>
          </TouchableOpacity>
        </View>
        <Text style={styles.inputDisclaimer}>
          TPC.ai · Knows your collection, GAS list, and tone profile
        </Text>
      </View>
    </KeyboardAvoidingView>

    {/* ── Weekly Pick detail sheet ── */}
    {weeklyPick && (
      <Modal
        visible={showWeeklyDetail}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWeeklyDetail(false)}
      >
        <View style={styles.detailOverlay}>
          <TouchableOpacity style={styles.detailBackdrop} activeOpacity={1} onPress={() => setShowWeeklyDetail(false)} />
          <SwipeDismissSheet style={[styles.detailSheet, { paddingBottom: insets.bottom + 24 }]} onDismiss={() => setShowWeeklyDetail(false)}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleRow}>
                <Ionicons name="sparkles" size={15} color={colors.gold} />
                <Text style={styles.detailTitle}>This Week's Pick</Text>
              </View>
              <TouchableOpacity onPress={() => setShowWeeklyDetail(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.detailPedal}>{weeklyPick.brand} {weeklyPick.model}</Text>
            {weeklyPick.category && (
              <Text style={styles.detailCategory}>{weeklyPick.category}</Text>
            )}
            <Text style={styles.detailCountdown}>{weeklyPickCountdownLabel()}</Text>
            <Text style={styles.detailWhyLabel}>Why this pedal?</Text>
            <Text style={styles.detailWhy}>{weeklyPick.why}</Text>
            <View style={styles.detailActions}>
              <TouchableOpacity
                style={styles.detailBtnReverb}
                activeOpacity={0.8}
                onPress={() => Linking.openURL(reverbSearchUrl(`${weeklyPick.brand} ${weeklyPick.model}`))}
              >
                <Ionicons name="storefront-outline" size={16} color="#fff" />
                <Text style={styles.detailBtnReverbText}>See on Reverb</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.detailBtnWishlist, weeklyWishlistState !== 'idle' && styles.detailBtnWishlistDone]}
                activeOpacity={0.8}
                disabled={weeklyWishlistState !== 'idle'}
                onPress={async () => {
                  setWeeklyWishlistState('loading');
                  const result = await addToWishlist(weeklyPick.brand, weeklyPick.model, {
                    category: weeklyPick.category ?? 'other',
                    subcategory: 'Weekly Pick',
                    description: weeklyPick.why ?? '',
                    analog: false,
                    price: null,
                  });
                  if (result === 'added') {
                    setWeeklyWishlistState('added');
                  } else if (result === 'exists') {
                    setWeeklyWishlistState('exists');
                  } else if (result === 'not_found') {
                    setWeeklyWishlistState('idle');
                    Alert.alert('Not in catalog yet', 'Could not add this pick right now. Please try again in a moment.');
                  } else {
                    setWeeklyWishlistState('idle');
                    Alert.alert('Could not add', 'Please try again in a moment.');
                  }
                }}
              >
                {weeklyWishlistState === 'loading' ? (
                  <ActivityIndicator size="small" color={colors.teal} />
                ) : weeklyWishlistState === 'added' ? (
                  <>
                    <Ionicons name="checkmark-circle" size={16} color={colors.teal} />
                    <Text style={styles.detailBtnWishlistText}>Added to Wishlist</Text>
                  </>
                ) : weeklyWishlistState === 'exists' ? (
                  <>
                    <Ionicons name="checkmark-circle" size={16} color={colors.textMuted} />
                    <Text style={[styles.detailBtnWishlistText, { color: colors.textMuted }]}>Already on Wishlist</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="bookmark-outline" size={16} color={colors.teal} />
                    <Text style={styles.detailBtnWishlistText}>Add to Wishlist</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </SwipeDismissSheet>
        </View>
      </Modal>
    )}
    </>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({
  message,
  showShare = false,
  showCopy = false,
}: {
  message: ChatMessage;
  showShare?: boolean;
  showCopy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isEmptyStreamingAssistant =
    !isUser &&
    Boolean(message.isStreaming) &&
    !getMessageText(message.content).trim();

  if (isEmptyStreamingAssistant) {
    return null;
  }

  const handleCopy = () => {
    Haptics.selectionAsync();
    Clipboard.setStringAsync(getMessageText(message.content));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      {!isUser && (
        <View style={styles.bubbleAvatar}>
          <Image source={require('../../assets/tpc-square.png')} style={styles.bubbleAvatarImage} />
        </View>
      )}
      <View style={styles.bubbleWithShare}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleAssistant,
            message.isStreaming && styles.bubbleStreaming,
          ]}
        >
          {isUser ? (
            <>
              {message.imageUri && (
                <Image
                  source={{ uri: message.imageUri }}
                  style={styles.bubbleImage}
                  resizeMode="cover"
                />
              )}
              {(() => {
                const txt = typeof message.content === 'string'
                  ? message.content
                  : (message.content as ContentBlock[]).find(b => b.type === 'text')?.text ?? '';
                return txt ? <Text style={styles.bubbleTextUser}>{txt}</Text> : null;
              })()}
            </>
          ) : (
            <FormattedText
              text={typeof message.content === 'string' ? message.content : ''}
              isStreaming={message.isStreaming}
            />
          )}
        </View>
        {(showShare || showCopy) && (
          <View style={styles.bubbleActionsRow}>
            {showCopy && (
              <TouchableOpacity
                style={styles.bubbleShareBtn}
                onPress={handleCopy}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={copied ? 'checkmark' : 'copy-outline'}
                  size={13}
                  color={copied ? colors.teal : colors.textMuted}
                />
                <Text style={[styles.bubbleShareText, copied && styles.bubbleCopiedText]}>
                  {copied ? 'Copied' : 'Copy'}
                </Text>
              </TouchableOpacity>
            )}
            {showShare && (
              <TouchableOpacity
                style={styles.bubbleShareBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  shareAdvisorResponse(getMessageText(message.content));
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="share-outline" size={13} color={colors.textMuted} />
                <Text style={styles.bubbleShareText}>Share</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function renderInlinePedalLinks(text: string, isBold: boolean, keyPrefix: string) {
  const chunks = text.split(/\[\[([^\]]{3,80})\]\]/g);
  return chunks.map((chunk, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (idx % 2 === 1) {
      return (
        <Text
          key={key}
          style={[styles.pedalLinkText, isBold && styles.boldText]}
          onPress={() => Linking.openURL(reverbSearchUrl(chunk))}
        >
          {chunk}
        </Text>
      );
    }
    if (!chunk) return null;
    return <Text key={key} style={isBold ? styles.boldText : undefined}>{chunk}</Text>;
  });
}

// ─── Formatted Text ───────────────────────────────────────────────────────────
// Renders markdown-ish text: **bold**, bullet points, pedal names highlighted
function FormattedText({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  if (!text) return null;

  // Split into lines for basic formatting
  const lines = text.split('\n');

  return (
    <View style={styles.formattedText}>
      {lines.map((line, i) => {
        const isBullet = line.trimStart().startsWith('- ') || line.trimStart().startsWith('• ');
        const trimmed = isBullet ? line.replace(/^\s*[-•]\s*/, '') : line;

        // Bold: **text**
        const parts = trimmed.split(/\*\*(.*?)\*\*/g);

        return (
          <View key={i} style={isBullet ? styles.bulletRow : undefined}>
            {isBullet && <Text style={styles.bulletDot}>·</Text>}
            <Text style={[styles.bubbleTextAssistant, isBullet && styles.bulletText]}>
              {parts.map((part, j) =>
                renderInlinePedalLinks(part, j % 2 === 1, `${i}-${j}`)
              )}
              {isStreaming && i === lines.length - 1 && (
                <Text style={styles.cursor}>▍</Text>
              )}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Thinking Indicator ───────────────────────────────────────────────────────
function ThinkingIndicator({ dotAnim }: { dotAnim: Animated.Value }) {
  return (
    <View style={[styles.bubbleRow]}>
      <View style={styles.bubbleAvatar}>
        <Image source={require('../../assets/tpc-square.png')} style={styles.bubbleAvatarImage} />
      </View>
      <View style={[styles.bubble, styles.bubbleAssistant, styles.thinkingBubble]}>
        <TypingDots dotAnim={dotAnim} color={colors.teal} />
      </View>
    </View>
  );
}

function TypingDots({
  dotAnim,
  color = colors.teal,
}: {
  dotAnim: Animated.Value;
  color?: string;
}) {
  return (
    <Animated.View style={[styles.thinkingDots, { opacity: dotAnim }]}>
      <View style={[styles.thinkingDot, { backgroundColor: color, opacity: 0.7 }]} />
      <View style={[styles.thinkingDot, styles.thinkingDotMid, { backgroundColor: color, opacity: 1 }]} />
      <View style={[styles.thinkingDot, { backgroundColor: color, opacity: 0.7 }]} />
    </Animated.View>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({
  ownedCount,
  onPromptPress,
  isPro,
  weeklyPick,
  weeklyPickLoading,
  onWeeklyPickTap,
  onCustomShopTap,
  onOpenPaywall,
}: {
  ownedCount: number;
  onPromptPress: (p: string) => void;
  isPro: boolean;
  weeklyPick: { brand: string; model: string; why: string; category: string | null; weekKey: string } | null;
  weeklyPickLoading: boolean;
  onWeeklyPickTap: () => void;
  onCustomShopTap: () => void;
  onOpenPaywall: () => void;
}) {
  // Shuffle once on mount — useMemo prevents reshuffling on every re-render
  const prompts = useMemo(
    () => [...STARTER_PROMPTS].sort(() => Math.random() - 0.5).slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <View style={styles.emptyState}>
      {/* Shortcut cards — Weekly Pick + Custom Shop */}
      <View style={styles.shortcutRow}>
        {/* Weekly Pick */}
        <TouchableOpacity
          style={styles.shortcutCard}
          activeOpacity={0.88}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); isPro ? onWeeklyPickTap() : onOpenPaywall(); }}
        >
          <LinearGradient
            colors={isPro && weeklyPick ? [colors.gold, colors.goldDark] : ['#2C1F08', '#1A1200']}
            style={styles.shortcutCardInner}
          >
            {/* Top: badge */}
            <View style={styles.shortcutBadgeRow}>
              <View style={styles.shortcutBadge}>
                <Text style={styles.shortcutBadgeText}>✦ WEEKLY PICK</Text>
              </View>
              {!isPro && (
                <View style={styles.shortcutLockChip}>
                  <Ionicons name="lock-closed" size={8} color={colors.gold} />
                  <Text style={styles.shortcutLockChipText}>PRO</Text>
                </View>
              )}
            </View>

            {/* Middle: content */}
            <View style={styles.shortcutContent}>
              {!isPro ? (
                <>
                  <View style={[styles.shortcutIconCircle, styles.shortcutIconCircleGold]}>
                    <Ionicons name="sparkles" size={18} color={colors.gold} />
                  </View>
                  <Text style={styles.shortcutLockedTitle}>Your pick{'\n'}is ready</Text>
                </>
              ) : weeklyPickLoading && !weeklyPick ? (
                <>
                  <View style={[styles.shortcutIconCircle, styles.shortcutIconCircleWhite]}>
                    <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
                  </View>
                  <Text style={styles.shortcutLoadingText}>Finding{'\n'}this week's…</Text>
                </>
              ) : weeklyPick ? (
                <>
                  <Text style={styles.shortcutPickBrand} numberOfLines={1}>{weeklyPick.brand}</Text>
                  <Text style={styles.shortcutPickModel} numberOfLines={2}>{weeklyPick.model}</Text>
                </>
              ) : null}
            </View>

            {/* Bottom: CTA */}
            <View style={styles.shortcutCtaRow}>
              <Text style={styles.shortcutCta}>{isPro && weeklyPick ? 'Open' : isPro ? 'View' : 'Unlock Pro'}</Text>
              <Ionicons name="arrow-forward" size={11} color="rgba(255,255,255,0.7)" />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Custom Shop */}
        <TouchableOpacity
          style={styles.shortcutCard}
          activeOpacity={0.88}
          onPress={onCustomShopTap}
        >
          <LinearGradient colors={[colors.teal, colors.tealDark]} style={styles.shortcutCardInner}>
            {/* Top: badge */}
            <View style={styles.shortcutBadgeRow}>
              <View style={styles.shortcutBadge}>
                <Text style={styles.shortcutBadgeText}>✦ CUSTOM SHOP</Text>
              </View>
            </View>

            {/* Middle: content */}
            <View style={styles.shortcutContent}>
              <View style={[styles.shortcutIconCircle, styles.shortcutIconCircleWhite]}>
                <Ionicons name="flame" size={18} color="#fff" />
              </View>
              <Text style={styles.shortcutShopTitle}>Feed Your{'\n'}GAS</Text>
            </View>

            {/* Bottom: CTA */}
            <View style={styles.shortcutCtaRow}>
              <Text style={styles.shortcutCta}>Get my pick</Text>
              <Ionicons name="arrow-forward" size={11} color="rgba(255,255,255,0.7)" />
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Hero */}
      <LinearGradient colors={['#3D5261', '#2A3E4E']} style={styles.emptyHero}>
        <View style={styles.emptyIconRing}>
          <LinearGradient colors={TEAL_GRADIENT} style={styles.emptyIconGradient}>
            <Ionicons name="chatbubble-ellipses" size={24} color="#fff" />
          </LinearGradient>
        </View>
        <Text style={styles.emptyTitle}>TPC Advisor</Text>
        <Text style={styles.emptySubtitle}>
          Your always-on gear expert. Ask about tone, pedals, signal chains, your board — anything music and gear. I know your full collection.
        </Text>
        {ownedCount === 0 && (
          <View style={styles.emptyHint}>
            <Ionicons name="information-circle-outline" size={14} color={colors.warning} style={{ marginTop: 1 }} />
            <Text style={styles.emptyHintText}>
              Add pedals to your collection first and I'll give you smarter recommendations
            </Text>
          </View>
        )}
      </LinearGradient>

      {/* Starter prompts */}
      <Text style={styles.starterLabel}>Try asking...</Text>
      <View style={styles.starterRow}>
        {prompts.map((prompt, i) => (
          <TouchableOpacity
            key={i}
            style={styles.starterChip}
            onPress={() => onPromptPress(prompt)}
            activeOpacity={0.7}
          >
            <Text style={styles.starterChipText}>{prompt}</Text>
          </TouchableOpacity>
        ))}
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  counterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingVertical: 5,
  },
  counterText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.gold + '20',
    borderBottomWidth: 1,
    borderBottomColor: colors.gold + '40',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  warningCTA: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  header: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerActionBtn: {
    padding: spacing.xs,
  },
  advisorIcon: {
    position: 'relative',
  },
  advisorIconGradient: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  advisorIconEmoji: {
    fontSize: 22,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.background,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  headerSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: 2,
  },
  contextPill: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.teal + '18',
    borderWidth: 1,
    borderColor: colors.teal + '40',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  contextPillText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.base,
    gap: spacing.sm,
  },
  messagesContentEmpty: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  bubbleWithShare: {
    flex: 1,
    gap: 4,
  },
  bubbleShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: spacing.xs,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  bubbleShareText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  bubbleActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.xs,
    paddingVertical: 2,
  },
  bubbleCopiedText: {
    color: colors.teal,
  },
  bubbleRowUser: {
    flexDirection: 'row-reverse',
  },
  bubbleAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    flexShrink: 0,
    marginBottom: 2,
    overflow: 'hidden',
  },
  bubbleAvatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  bubbleAvatarText: {
    fontSize: 16,
    lineHeight: 32,
    textAlign: 'center',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  bubbleUser: {
    backgroundColor: colors.teal,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleStreaming: {
    borderColor: colors.teal + '60',
  },
  bubbleTextUser: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: '#fff',
    lineHeight: 22,
  },
  bubbleTextAssistant: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  formattedText: {
    gap: 2,
  },
  boldText: {
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingLeft: 4,
  },
  bulletDot: {
    fontSize: 18,
    color: colors.teal,
    lineHeight: 22,
    marginTop: -1,
  },
  bulletText: {
    flex: 1,
  },
  cursor: {
    color: colors.teal,
    opacity: 0.8,
  },
  thinkingBubble: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
  thinkingDots: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  thinkingDotMid: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pedalLinkText: {
    color: colors.teal,
    textDecorationLine: 'underline',
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  pendingImageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  pendingImageThumb: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
  pendingImageRemove: {
    marginLeft: -10,
    marginTop: -6,
  },
  cameraButton: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  bubbleImage: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.border,
  },
  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  queueBannerText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    maxHeight: 120,
    minHeight: 44,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonIcon: {
    fontSize: 20,
    color: '#fff',
    fontFamily: typography.bodySemiBold,
    marginTop: -2,
  },
  inputDisclaimer: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  // Empty state
  emptyState: {
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  emptyHero: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  emptyIconRing: {
    padding: 4,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: colors.teal + '40',
    marginBottom: spacing.xs,
  },
  emptyIconGradient: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    // kept for layout ref; icon rendered via Ionicons
  },
  emptyTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: '#fff',
  },
  emptySubtitle: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.warning + '18',
    borderWidth: 1,
    borderColor: colors.warning + '40',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  emptyHintText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.warning,
    lineHeight: 18,
  },
  starterLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  starterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  starterChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  starterChipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },

  // ─── Shortcut cards ──────────────────────────────────────────────────────────
  shortcutRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  shortcutCard: {
    flex: 1,
  },
  shortcutCardInner: {
    flex: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    minHeight: 144,
    justifyContent: 'space-between',
  },
  shortcutBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  shortcutBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  shortcutBadgeText: {
    fontSize: 8,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.8,
  },
  shortcutLockChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.gold + '22',
    borderWidth: 1,
    borderColor: colors.gold + '55',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  shortcutLockChipText: {
    fontSize: 8,
    fontFamily: typography.bodySemiBold,
    color: colors.gold,
    letterSpacing: 0.5,
  },
  shortcutContent: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: 5,
  },
  shortcutIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  shortcutIconCircleGold: {
    backgroundColor: 'rgba(201,168,48,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,48,0.3)',
  },
  shortcutIconCircleWhite: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  shortcutLockedTitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.display,
    color: colors.gold,
    lineHeight: 18,
  },
  shortcutLoadingText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.display,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 18,
  },
  shortcutPickBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  shortcutPickModel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.display,
    color: '#fff',
    lineHeight: 20,
  },
  shortcutShopTitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.display,
    color: '#fff',
    lineHeight: 18,
  },
  shortcutCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  shortcutCta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: 'rgba(255,255,255,0.75)',
  },

  // ─── Weekly Pick detail modal ─────────────────────────────────────────────────
  detailOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  detailBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  detailSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  detailHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailTitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.gold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  detailPedal: {
    fontSize: typography.sizes.xxl,
    fontFamily: typography.display,
    color: colors.textPrimary,
    lineHeight: 32,
  },
  detailCategory: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: -spacing.xs,
  },
  detailCountdown: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.gold,
    letterSpacing: 0.3,
  },
  detailWhyLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  detailWhy: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  detailActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  detailBtnReverb: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#E25B45',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  detailBtnReverbText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  detailBtnWishlist: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1.5,
    borderColor: colors.teal,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(43,181,160,0.06)',
  },
  detailBtnWishlistDone: {
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  detailBtnWishlistText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
});
