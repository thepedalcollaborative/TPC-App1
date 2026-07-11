import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { USE_NATIVE_DRIVER } from '../lib/iosVersion';
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
import { useRoute, RouteProp } from '@react-navigation/native';
import { AIStackParamList, RootStackParamList } from '../types/navigation';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
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

  const { session, ownedPedals, wishlistPedals, retiredPedals, boards, profile, openPaywall } = useStore();

  const isPro = Boolean(profile?.is_premium) || hasBetaFullAccess();
  const { gateState, applyQuota } = useMessageGate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);
  const [memory, setMemory] = useState('');
  const [queuedCount, setQueuedCount] = useState(0);
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
          Animated.timing(dotAnim, { toValue: 1, duration: 600, useNativeDriver: USE_NATIVE_DRIVER }),
          Animated.timing(dotAnim, { toValue: 0, duration: 600, useNativeDriver: USE_NATIVE_DRIVER }),
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

    // Quota is enforced server-side inside tpc-advisor itself — a 403/402
    // comes back on the send and is handled in the error chunk below.
    setSessionWarning(null);

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
        if (chunk.quota) applyQuota(chunk.quota);
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
        // Server-side quota rejection — undo the optimistic UI entirely,
        // restore the draft, and drop any queued sends (they'd all fail too).
        if (chunk.code === 'pro_required' || chunk.code === 'messages_depleted') {
          setMessages(prev => prev.filter(m => m.id !== assistantId && m.id !== userMessage.id));
          setInput(text.trim());
          setIsThinking(false);
          isSubmittingRef.current = false;
          messageQueue.current = [];
          setQueuedCount(0);
          if (chunk.code === 'pro_required') {
            openPaywall('advisor');
          } else {
            setSessionWarning("You've used all your messages this month and have no bonus credits left.");
          }
          return;
        }
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
  }, [ownedPedals, wishlistPedals, retiredPedals, profile, boards, isPro, openPaywall, scrollToBottom, session, systemPrompt, applyQuota]);

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
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            style={styles.headerBackBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
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
      {!hasBetaFullAccess() && gateState && (
        <View style={styles.counterBar}>
          <Ionicons name="chatbubble-ellipses-outline" size={12} color={colors.textMuted} />
          <Text style={styles.counterText}>
            {!isPro && gateState.freeUsed != null
              ? `${gateState.freeUsed} of ${gateState.freeAllotment ?? 3} free messages used`
              : gateState.onCredits
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

  // Long-press a user message to copy its text (assistant messages have a Copy button).
  const handleLongPressCopy = () => {
    const txt = getMessageText(message.content).trim();
    if (!txt) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Clipboard.setStringAsync(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const userText = isUser
    ? (typeof message.content === 'string'
        ? message.content
        : (message.content as ContentBlock[]).find(b => b.type === 'text')?.text ?? '')
    : '';

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      {!isUser && (
        <View style={styles.bubbleAvatar}>
          <Image source={require('../../assets/tpc-square.png')} style={styles.bubbleAvatarImage} />
        </View>
      )}
      <View style={styles.bubbleWithShare}>
        {isUser ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onLongPress={handleLongPressCopy}
            delayLongPress={300}
            style={[styles.bubble, styles.bubbleUser]}
          >
            {message.imageUri && (
              <Image
                source={{ uri: message.imageUri }}
                style={styles.bubbleImage}
                resizeMode="cover"
              />
            )}
            {userText ? <Text style={styles.bubbleTextUser}>{userText}</Text> : null}
          </TouchableOpacity>
        ) : (
          <View
            style={[
              styles.bubble,
              styles.bubbleAssistant,
              message.isStreaming && styles.bubbleStreaming,
            ]}
          >
            <FormattedText
              text={typeof message.content === 'string' ? message.content : ''}
              isStreaming={message.isStreaming}
            />
          </View>
        )}
        {isUser && copied && (
          <View style={styles.bubbleUserCopiedRow}>
            <Ionicons name="checkmark" size={13} color={colors.teal} />
            <Text style={[styles.bubbleShareText, styles.bubbleCopiedText]}>Copied</Text>
          </View>
        )}
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
}: {
  ownedCount: number;
  onPromptPress: (p: string) => void;
}) {
  const prompts = useMemo(
    () => [...STARTER_PROMPTS].sort(() => Math.random() - 0.5).slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <View style={styles.emptyState}>
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
  headerBackBtn: {
    marginRight: spacing.xs,
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
  bubbleUserCopiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    paddingRight: spacing.xs,
    paddingVertical: 2,
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

});
