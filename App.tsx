import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from './src/lib/supabase';
import { useStore } from './src/hooks/useStore';
import { configureRevenueCat, hasBetaFullAccess } from './src/lib/subscription';
import {
  requestNotificationPermissions,
  scheduleWeeklyPickNotification,
  scheduleVaultDigestNotification,
  cancelAllTpcNotifications,
} from './src/lib/notifications';
import { colors, typography } from './src/theme';
import { PlayerOnboarding, PostOnboardingScreen } from './src/components';
import { RootStackParamList, HomeStackParamList, BoardsStackParamList, AIStackParamList } from './src/types/navigation';
import PaywallScreen from './src/screens/PaywallScreen';

// Screens
import HomeScreen from './src/screens/HomeScreen';
import CollectionScreen from './src/screens/CollectionScreen';
import AdvisorScreen from './src/screens/AdvisorScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AdminScreen from './src/screens/AdminScreen';
import AuthScreen from './src/screens/AuthScreen';
import FinderScreen from './src/screens/FinderScreen';
import BoardsScreen from './src/screens/BoardsScreen';
import BoardDetailScreen from './src/screens/BoardDetailScreen';
import AIHubScreen from './src/screens/AIHubScreen';
import VideosScreen from './src/screens/VideosScreen';

// Defensive wrapper — prevents crash if native module isn't linked in Expo Go
try { SplashScreen.preventAutoHideAsync(); } catch { /* no-op */ }

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const BoardsStack = createNativeStackNavigator<BoardsStackParamList>();
const AIStack = createNativeStackNavigator<AIStackParamList>();

const splashSquare = require('./assets/tpc-square.png');
const splashText = require('./assets/tpc-text.png');
const splashFinal = require('./assets/tpc-final.png');

function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const { width } = useWindowDimensions();
  const finalSource = Image.resolveAssetSource(splashFinal);
  const finalAspect = finalSource?.width ? finalSource.height / finalSource.width : 0.25;
  const finalWidth = Math.min(900, Math.max(260, width * 0.82));
  const finalHeight = Math.max(90, finalWidth * finalAspect);
  const gap = 10;
  const squareSize = Math.max(90, finalHeight);
  const textWidth = Math.max(140, finalWidth - squareSize - gap);

  const rotation = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslate = useRef(new Animated.Value(0)).current;
  const rowOpacity = useRef(new Animated.Value(0)).current;
  const introFade = useRef(new Animated.Value(1)).current;
  const exitTranslate = useRef(new Animated.Value(0)).current;
  const hasPlayed = useRef(false);

  const spin = useMemo(
    () =>
      rotation.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
      }),
    [rotation],
  );

  useEffect(() => {
    if (hasPlayed.current) return;
    hasPlayed.current = true;
    textTranslate.setValue(-textWidth * 0.7);
    rowOpacity.setValue(0);
    introFade.setValue(1);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(introFade, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(rowOpacity, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(rotation, {
          toValue: 1,
          duration: 810,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.timing(textOpacity, {
            toValue: 1,
            duration: 540,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(textTranslate, {
            toValue: 0,
            duration: 648,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.delay(750),
      Animated.timing(exitTranslate, {
        toValue: -width,
        duration: 396,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        onFinish();
      }
    });
  }, [exitTranslate, introFade, onFinish, rotation, rowOpacity, textOpacity, textTranslate, textWidth, width]);

  return (
    <Animated.View style={[styles.splashRoot, { transform: [{ translateX: exitTranslate }] }]}>
      <Animated.View style={[styles.splashRow, { opacity: rowOpacity, width: finalWidth }]}>
        <Animated.Image
          source={splashSquare}
          style={[
            styles.splashSquare,
            {
              width: squareSize,
              height: squareSize,
              transform: [{ rotate: spin }],
            },
          ]}
          resizeMode="contain"
        />
        <View style={[styles.splashTextClip, { width: textWidth }]}>
          <Animated.Image
            source={splashText}
            style={[
              styles.splashText,
              {
                width: textWidth,
                height: finalHeight,
                opacity: textOpacity,
                transform: [{ translateX: textTranslate }],
              },
            ]}
            resizeMode="contain"
          />
        </View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', opacity: introFade }]}
      />
    </Animated.View>
  );
}

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
      <HomeStack.Screen name="Finder" component={FinderScreen} />
    </HomeStack.Navigator>
  );
}

function BoardsStackNavigator() {
  return (
    <BoardsStack.Navigator screenOptions={{ headerShown: false }}>
      <BoardsStack.Screen name="BoardsMain" component={BoardsScreen} />
      <BoardsStack.Screen name="BoardDetail" component={BoardDetailScreen} />
    </BoardsStack.Navigator>
  );
}

function AIStackNavigator() {
  return (
    <AIStack.Navigator screenOptions={{ headerShown: false }}>
      <AIStack.Screen name="AIHub"   component={AIHubScreen} />
      <AIStack.Screen name="Advisor" component={AdvisorScreen} />
      <AIStack.Screen name="Finder"  component={FinderScreen} />
    </AIStack.Navigator>
  );
}

// ─── Bottom Tabs ──────────────────────────────────────────────────────────────
function MainTabs() {
  const { wishlistDropCount } = useStore();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabel: ({ color }) => (
          <Text allowFontScaling={false} style={[styles.tabLabel, { color }]}>
            {route.name}
          </Text>
        ),
        tabBarIcon: ({ focused, color, size }) => {
          // Vault uses MaterialCommunityIcons safe icon
          if (route.name === 'Vault') {
            return (
              <MaterialCommunityIcons
                name={focused ? 'safe' : 'safe-square-outline'}
                size={size}
                color={color}
              />
            );
          }
          // All others use Ionicons
          const iconMap: Record<string, [string, string]> = {
            Home:    ['home',             'home-outline'],
            Boards:  ['albums',           'albums-outline'],
            Videos:  ['play-circle',      'play-circle-outline'],
            'TPC.ai': ['sparkles',         'sparkles-outline'],    // center — most premium
          };
          const [active, inactive] = iconMap[route.name] ?? ['help-circle', 'help-circle-outline'];
          return (
            <Ionicons
              name={(focused ? active : inactive) as keyof typeof Ionicons.glyphMap}
              size={size}
              color={color}
            />
          );
        },
      })}
    >
      {/* Tab order: Home / Vault / TPC.ai / Boards / Videos */}
      <Tab.Screen name="Home"    component={HomeStackNavigator} />
      <Tab.Screen
        name="Vault"
        component={CollectionScreen}
        options={wishlistDropCount > 0 ? {
          tabBarBadge: wishlistDropCount,
          tabBarBadgeStyle: { backgroundColor: colors.success, fontSize: 10 },
        } : undefined}
      />
      <Tab.Screen name="TPC.ai"  component={AIStackNavigator} />
      <Tab.Screen name="Boards"  component={BoardsStackNavigator} />
      <Tab.Screen name="Videos" component={VideosScreen} />
    </Tab.Navigator>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isSkippedRecently(skippedAt?: string): boolean {
  if (!skippedAt) return false;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(skippedAt).getTime() < SEVEN_DAYS_MS;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const {
    session, setSession, refreshUserImages, profile, fetchProfile,
    paywallVisible, paywallReason, closePaywall,
    ownedPedals, totalMarketValue,
  } = useStore();
  const [initialized, setInitialized] = useState(false);
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [showPostOnboarding, setShowPostOnboarding] = useState(false);

  const [fontsLoaded] = useFonts({
    RuckSackBlack: require('./assets/fonts/RuckSackBlack.otf'),
    SpaceGrotesk_700Bold,   // kept as fallback
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  // Bootstrap Supabase auth
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        const msg = String(error.message ?? '');
        if (msg.toLowerCase().includes('refresh token')) {
          // Avoid hard sign-out on transient refresh-token issues.
          // We'll rely on auth state events / next successful sign-in.
          if (__DEV__) console.warn('[Auth] getSession refresh token warning:', msg);
          setInitialized(true);
          return;
        }
      }
      setSession(session);
      setInitialized(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Beta safety: ignore external SIGNED_OUT churn from transient token issues.
      // Explicit in-app sign out already clears store state directly.
      if (event === 'SIGNED_OUT') return;
      if (session) {
        setSession(session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Hide splash once fonts + auth are ready
  useEffect(() => {
    if (fontsLoaded && initialized) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, initialized]);

  // Configure RevenueCat and sync Pro entitlement whenever user signs in
  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    configureRevenueCat(userId);
    // Beta builds grant full access via app.json flag — mirror that into the DB so
    // server-side edge functions (which check is_premium directly) also accept the user.
    if (hasBetaFullAccess()) {
      supabase.from('user_profiles').update({ is_premium: true }).eq('id', userId).then(undefined, () => {});
    }
    fetchProfile();
    // Request notification permissions and schedule recurring reminders on sign-in
    requestNotificationPermissions().then(granted => {
      if (!granted) return;
      scheduleWeeklyPickNotification().catch(() => {});
      scheduleVaultDigestNotification(ownedPedals.length, totalMarketValue).catch(() => {});
    });
  }, [session?.user?.id]);

  // Cancel notifications on sign-out
  useEffect(() => {
    if (!session) {
      cancelAllTpcNotifications().catch(() => {});
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      refreshUserImages();
    }, 6 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshUserImages, session]);

  // Track when profile has loaded (async — starts null)
  useEffect(() => {
    if (profile !== null) {
      setProfileLoaded(true);
    } else if (!session) {
      setProfileLoaded(false);
    }
  }, [profile, session]);

  // Computed: should we show the first-run onboarding?
  const needsOnboarding =
    profileLoaded &&
    Boolean(session) &&
    Boolean(profile) &&
    !profile?.pedal_expert_profile?.onboarding_completed_at &&
    !isSkippedRecently(profile?.pedal_expert_profile?.onboarding_skipped_at);

  // Keep splash visible while loading
  if (!fontsLoaded || !initialized) {
    return null;
  }

  const baseContent = !session ? (
    <AuthScreen />
  ) : (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen
          name="Admin"
          component={AdminScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.appRoot}>
        {baseContent}

        {/* ── First-run onboarding gate ──────────────────────────────────── */}
        {session && (
          <Modal
            visible={needsOnboarding && !showPostOnboarding}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={() => {}}
          >
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
              <PlayerOnboarding
                onComplete={async (fullProfile) => {
                  // Always update local state first so user is never trapped in onboarding.
                  useStore.setState((s) => ({
                    profile: s.profile
                      ? ({ ...s.profile, pedal_expert_profile: fullProfile } as typeof s.profile)
                      : s.profile,
                  }));
                  setShowPostOnboarding(true);
                  try {
                    await supabase
                      .from('user_profiles')
                      .update({ pedal_expert_profile: fullProfile })
                      .eq('id', session.user.id);
                    await fetchProfile();
                  } catch {}
                }}
                onDismiss={async () => {
                  const existing = profile?.pedal_expert_profile ?? {};
                  const skipped = { ...existing, onboarding_skipped_at: new Date().toISOString() };
                  // Local-first so "Skip for now" always works.
                  useStore.setState((s) => ({
                    profile: s.profile
                      ? ({ ...s.profile, pedal_expert_profile: skipped } as typeof s.profile)
                      : s.profile,
                  }));
                  try {
                    await supabase
                      .from('user_profiles')
                      .update({ pedal_expert_profile: skipped })
                      .eq('id', session.user.id);
                    await fetchProfile();
                  } catch {}
                }}
              />
            </SafeAreaView>
          </Modal>
        )}

        {/* ── Post-onboarding conversion screen ─────────────────────────── */}
        {session && (
          <Modal
            visible={showPostOnboarding}
            animationType="fade"
            presentationStyle="fullScreen"
            onRequestClose={() => setShowPostOnboarding(false)}
          >
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
              <PostOnboardingScreen
                onGetMyPick={() => {
                  setShowPostOnboarding(false);
                  // Navigation to Finder happens via home screen after modal closes
                  // The AI hero card will be front-and-center on home
                }}
                onExplore={() => setShowPostOnboarding(false)}
              />
            </SafeAreaView>
          </Modal>
        )}

        {/* ── Global Paywall Modal ───────────────────────────────────────── */}
        <PaywallScreen
          visible={paywallVisible}
          reason={paywallReason}
          onClose={closePaywall}
        />

        {showAnimatedSplash && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <AnimatedSplash onFinish={() => setShowAnimatedSplash(false)} />
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  splashRoot: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  splashSquare: {
    marginRight: 12,
  },
  splashText: {
  },
  splashRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  splashTextClip: {
    overflow: 'hidden',
  },
  splashFinal: {
    position: 'absolute',
  },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 4,
    height: 85,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: typography.bodyMedium,
    marginTop: 2,
  },
});
