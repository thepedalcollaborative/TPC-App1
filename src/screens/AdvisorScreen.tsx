import React, { useState, useRef, useCallback, useEffect } from 'react';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import { useStore } from '../hooks/useStore';
import { askClaude, Message } from '../lib/anthropic';
import { buildSystemPrompt, STARTER_PROMPTS } from '../lib/systemPrompt';
import { advisorGate, incrementAdvisorCount, hasBetaFullAccess } from '../lib/subscription';
import { loadMemory, refreshMemory } from '../lib/memory';
import { reverbSearchUrl } from '../lib/reverb';

type ChatMessage = Message & {
  id: string;
  isStreaming?: boolean;
};

const TEAL_GRADIENT: [string, string] = [colors.teal, colors.tealDark];
const SURFACE_GRADIENT: [string, string] = ['#FFFFFF', '#F7F4F0'];

export default function AdvisorScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { session, ownedPedals, wishlistPedals, retiredPedals, boards, profile, openPaywall } = useStore();

  const isPro = Boolean(profile?.is_premium) || hasBetaFullAccess();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);
  const [memory, setMemory] = useState('');
  const memoryRef = useRef('');
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const dotAnim = useRef(new Animated.Value(0)).current;

  // Load player memory on mount
  useEffect(() => {
    if (!session?.user?.id) return;
    loadMemory(session.user.id).then(m => {
      setMemory(m);
      memoryRef.current = m;
    });
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

  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated });
    }, 80);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isThinking) return;

    // ── Usage gate ──────────────────────────────────────────────────────────
    const gate = await advisorGate(isPro);
    if (!gate.allowed) {
      openPaywall('advisor');
      return;
    }
    if (gate.showWarning) {
      setSessionWarning(`Last free session this month — upgrade for unlimited access.`);
    } else {
      setSessionWarning(null);
    }
    // Increment usage count (non-blocking)
    incrementAdvisorCount().catch(() => {});
    // ────────────────────────────────────────────────────────────────────────

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsThinking(true);
    scrollToBottom();
    Haptics.selectionAsync();

    // Build conversation history for API (exclude streaming placeholders).
    // Cap at the last 20 messages (10 turns) to bound token costs on long sessions.
    // Prompt caching on the system prompt already covers the static context.
    const MAX_HISTORY = 20;
    const history: Message[] = [...messages, userMessage]
      .slice(-MAX_HISTORY)
      .map(m => ({ role: m.role, content: m.content }));

    const assistantId = (Date.now() + 1).toString();
    let accumulated = '';

    // Add empty assistant message that we'll stream into
    setMessages(prev => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      },
    ]);

    const systemPrompt = buildSystemPrompt(
      ownedPedals,
      wishlistPedals,
      retiredPedals,
      profile?.pedal_expert_profile ?? null,
      boards.length,
      memoryRef.current,
    );

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
      } else if (chunk.type === 'error') {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  content: chunk.error ?? 'Something went wrong. Please try again.',
                  isStreaming: false,
                }
              : m
          )
        );
        setIsThinking(false);
      }
    }, { enableWebSearch: true, maxTokens: 1400 });
  }, [messages, isThinking, ownedPedals, wishlistPedals, retiredPedals, profile, boards, isPro, openPaywall, scrollToBottom, session]);

  const handleStarterPrompt = (prompt: string) => {
    sendMessage(prompt);
  };

  const isEmpty = messages.length === 0;
  const hasStreamingAssistantWithText = messages.some(
    (m) => m.role === 'assistant' && Boolean(m.isStreaming) && m.content.trim().length > 0
  );

  return (
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
          {/* Back to AI Hub */}
          {navigation.canGoBack() && (
            <TouchableOpacity
              onPress={() => { Haptics.selectionAsync(); navigation.goBack(); }}
              style={styles.headerBackBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          <View style={styles.advisorIcon}>
            <LinearGradient colors={TEAL_GRADIENT} style={styles.advisorIconGradient}>
              <Text style={styles.advisorIconEmoji}>🎛</Text>
            </LinearGradient>
            <View style={styles.onlineDot} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>TPC Advisor</Text>
            <Text style={styles.headerSub}>
              Powered by Claude · Knows your collection
            </Text>
          </View>
        </View>

        {/* Collection context pill */}
        <View style={styles.contextPill}>
          <Text style={styles.contextPillText}>
            🎸 {ownedPedals.length} owned · {wishlistPedals.length} wishlist{profile?.pedal_expert_profile?.onboarding_completed_at ? ' · tone profile active' : ''}
          </Text>
        </View>
      </LinearGradient>

      {/* Usage warning banner */}
      {sessionWarning && (
        <TouchableOpacity
          style={styles.warningBanner}
          onPress={() => openPaywall('advisor')}
          activeOpacity={0.85}
        >
          <Ionicons name="sparkles-outline" size={14} color={colors.gold} />
          <Text style={styles.warningText}>{sessionWarning}</Text>
          <Text style={styles.warningCTA}>Upgrade →</Text>
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
            {messages.map(message => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {isThinking && !hasStreamingAssistantWithText && <ThinkingIndicator dotAnim={dotAnim} />}
          </>
        )}
      </ScrollView>

      {/* Input */}
      <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about pedals, genres, your board..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
            blurOnSubmit={false}
            editable={!isThinking}
          />
          <TouchableOpacity
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || isThinking}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={input.trim() && !isThinking ? TEAL_GRADIENT : ['#E2DDD7', '#E2DDD7']}
              style={styles.sendButton}
            >
              <Text style={styles.sendButtonIcon}>↑</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
        <Text style={styles.inputDisclaimer}>
          TPC Advisor · Knows your collection, wishlist, and tone profile
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({
  message
}: {
  message: ChatMessage;
}) {
  const isUser = message.role === 'user';
  const isEmptyStreamingAssistant =
    !isUser &&
    Boolean(message.isStreaming) &&
    !message.content.trim();

  if (isEmptyStreamingAssistant) {
    return null;
  }

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      {!isUser && (
        <View style={styles.bubbleAvatar}>
          <Image source={require('../../assets/tpc-square.png')} style={styles.bubbleAvatarImage} />
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
          message.isStreaming && styles.bubbleStreaming,
        ]}
      >
        {isUser ? (
          <Text style={styles.bubbleTextUser}>{message.content}</Text>
        ) : (
          <FormattedText text={message.content} isStreaming={message.isStreaming} />
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
  // Shuffle and pick 4 prompts
  const prompts = [...STARTER_PROMPTS].sort(() => Math.random() - 0.5).slice(0, 4);

  return (
    <View style={styles.emptyState}>
      {/* Hero */}
      <LinearGradient colors={['#3D5261', '#2A3E4E']} style={styles.emptyHero}>
        <View style={styles.emptyIconRing}>
          <LinearGradient colors={TEAL_GRADIENT} style={styles.emptyIconGradient}>
            <Text style={styles.emptyIcon}>🎛</Text>
          </LinearGradient>
        </View>
        <Text style={styles.emptyTitle}>TPC Advisor</Text>
        <Text style={styles.emptySubtitle}>
          Your always-on gear expert. Ask about tone, pedals, signal chains, your board — anything music and gear. I know your full collection.
        </Text>
        {ownedCount === 0 && (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyHintText}>
              💡 Add pedals to your collection first and I'll give you smarter recommendations
            </Text>
          </View>
        )}
      </LinearGradient>

      {/* Starter prompts */}
      <Text style={styles.starterLabel}>Try asking...</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.starterRow}
      >
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
      </ScrollView>

      {/* Capabilities */}
      <View style={styles.capabilityList}>
        {[
          {
            emoji: '🎯',
            text: 'Knows your collection, wishlist & tone profile',
            prompt: "Based on my collection and wishlist, what's the best next move for my tone?",
          },
          {
            emoji: '🔌',
            text: 'Signal chain, board layout & gear pairings',
            prompt: 'Help me optimize my signal chain and board order.',
          },
          {
            emoji: '🎸',
            text: 'Tone, technique, genre & style advice',
            prompt: 'Give me 3 practical tweaks to improve my tone for my style.',
          },
          {
            emoji: '🏪',
            text: 'Ready to buy? Head to Custom Shop for a curated pick',
            prompt: "I'm ready to buy soon. Prep me for a Custom Shop run.",
          },
        ].map((item, i) => (
          <TouchableOpacity
            key={i}
            style={styles.capabilityItem}
            onPress={() => onPromptPress(item.prompt)}
            activeOpacity={0.75}
          >
            <Text style={styles.capabilityEmoji}>{item.emoji}</Text>
            <Text style={styles.capabilityText}>{item.text}</Text>
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
  headerBackBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.xs,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
    flex: 1,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.sm,
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
    paddingHorizontal: spacing.base,
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
    fontSize: 24,
  },
  emptyTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyHint: {
    backgroundColor: colors.warning + '18',
    borderWidth: 1,
    borderColor: colors.warning + '40',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  emptyHintText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.warning,
    textAlign: 'center',
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
    gap: spacing.sm,
    paddingRight: spacing.base,
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
  capabilityList: {
    gap: spacing.xs,
  },
  capabilityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  capabilityEmoji: {
    fontSize: 20,
  },
  capabilityText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
  },
});
