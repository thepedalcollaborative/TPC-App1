import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import { AIStackParamList } from '../types/navigation';

type Nav = NativeStackNavigationProp<AIStackParamList>;

type CardConfig = {
  gradient: [string, string];
  icon: React.ComponentProps<typeof Ionicons>['name'];
  badge: string;
  title: string;
  subtitle: string;
  onPress: (nav: Nav) => void;
};

const CARDS: CardConfig[] = [
  {
    gradient: ['#3D5261', '#2A3E4E'],
    icon: 'sparkles',
    badge: '✦ CUSTOM SHOP',
    title: 'Feed Your GAS',
    subtitle: 'Expertly-curated for your tone & style',
    onPress: (nav) => nav.navigate('Finder', { startMode: 'expert' }),
  },
  {
    gradient: [colors.teal, colors.tealDark],
    icon: 'shuffle',
    badge: '✦ SURPRISE ME',
    title: 'Surprise Me',
    subtitle: 'Completely random, outside your collection',
    onPress: (nav) => nav.navigate('Finder', { startMode: 'surpriseMe' }),
  },
  {
    gradient: [colors.rose, colors.roseDark],
    icon: 'flame',
    badge: '✦ GAS OR PASS',
    title: 'GAS or Pass',
    subtitle: 'Swipe through pedals you don\'t own yet',
    onPress: (nav) => nav.navigate('Finder', { startMode: 'gasOrPass' }),
  },
  {
    gradient: ['#5B4A8A', '#3D3060'],
    icon: 'chatbubble-ellipses',
    badge: '✦ TPC ADVISOR',
    title: 'Ask the Advisor',
    subtitle: 'Your personal tone consultant — always on',
    onPress: (nav) => nav.navigate('Advisor'),
  },
];

export default function AIHubScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>TPC.ai</Text>
        <Text style={styles.headerSub}>Expert tools powered by Claude</Text>
      </View>

      {CARDS.map((card) => (
        <TouchableOpacity
          key={card.badge}
          style={styles.card}
          activeOpacity={0.88}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            card.onPress(navigation);
          }}
        >
          <LinearGradient colors={card.gradient} style={styles.cardInner}>
            <View style={styles.cardLeft}>
              <View style={styles.iconCircle}>
                <Ionicons name={card.icon} size={22} color="rgba(255,255,255,0.9)" />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardBadge}>{card.badge}</Text>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.cardSubtitle}>{card.subtitle}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.5)" />
          </LinearGradient>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: 12,
  },
  header: {
    marginBottom: 8,
  },
  headerTitle: {
    fontFamily: typography.display,
    fontSize: 32,
    color: colors.textPrimary,
    lineHeight: 38,
  },
  headerSub: {
    fontFamily: typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 20,
    gap: 16,
  },
  cardLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardText: {
    flex: 1,
  },
  cardBadge: {
    fontFamily: typography.bodySemiBold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 1,
    marginBottom: 4,
  },
  cardTitle: {
    fontFamily: typography.display,
    fontSize: 20,
    color: '#FFFFFF',
    lineHeight: 24,
  },
  cardSubtitle: {
    fontFamily: typography.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 3,
    lineHeight: 18,
  },
});
