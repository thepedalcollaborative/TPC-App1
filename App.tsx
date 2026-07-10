import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
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
import { createStackNavigator } from '@react-navigation/stack';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableScreens } from 'react-native-screens';
import { isAffectedIOSVersion } from './src/lib/iosVersion';
import { supabase } from './src/lib/supabase';
import { useStore } from './src/hooks/useStore';
import {
  requestNotificationPermissions,
  scheduleWeeklyPickNotification,
  scheduleVaultDigestNotification,
  scheduleReengagementNotification,
  savePushToken,
  cancelAllTpcNotifications,
  addNotificationOpenHandler,
} from './src/lib/notifications';
import { colors, typography } from './src/theme';
import { PlayerOnboarding, PostOnboardingScreen, WelcomeOnboarding } from './src/components';
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
import GearHistoryScreen from './src/screens/GearHistoryScreen';
import ChatHistoryScreen from './src/screens/ChatHistoryScreen';
import LegalScreen from './src/screens/LegalScreen';
import PublicProfileScreen from './src/screens/PublicProfileScreen';
import AccountSettingsScreen from './src/screens/AccountSettingsScreen';

// Computed once at JS bundle load, before any component mounts or native module
// void methods are invoked. On iOS 26.0–26.5, RN 0.81's TurboModule interop
// dispatches void methods on background GCD threads, which causes any UIKit
// access to throw an ObjC NSException that aborts the process. Apple fixed
// this in iOS 26.6. We gate all UIKit-touching modules on this flag.
const AFFECTED_IOS = isAffectedIOSVersion();

// Prevent react-native-screens from calling UIKit void methods via TurboModule.
// enableScreens(false) only sets a JS flag — it does NOT call any native method,
// so it is safe to call unconditionally on AFFECTED_IOS.
if (AFFECTED_IOS) {
  try { enableScreens(false); } catch { /* no-op */ }
}

// On iOS 26.0–26.5, preventAutoHideAsync() is a void TurboModule call that
// dispatches on a background GCD thread and crashes via ObjC exception.
// Skip it on affected versions — the splash auto-hides immediately, which is
// acceptable given the app was otherwise unlaunchable on those versions.
if (!AFFECTED_IOS) {
  try { SplashScreen.preventAutoHideAsync(); } catch { /* no-op */ }
}

const Tab = createBottomTabNavigator();

// On iOS 26.0–26.5, NativeStackNavigator calls RNScreens UIKit void methods on
// background GCD threads → ObjC NSException → abort. The pure-JS StackNavigator
// avoids all native stack module calls; enableScreens(false) ensures Screen/
// ScreenContainer fall back to plain Views. Swipe-back is unavailable on
// affected iOS but the app is fully functional.
const _makeStack = AFFECTED_IOS
  ? createStackNavigator as unknown as typeof createNativeStackNavigator
  : createNativeStackNavigator;

const Stack = _makeStack<RootStackParamList>();
const HomeStack = _makeStack<HomeStackParamList>();
const BoardsStack = _makeStack<BoardsStackParamList>();
const AIStack = _makeStack<AIStackParamList>();

const navigationRef = createNavigationContainerRef();

const splashSquare = require('./assets/tpc-square.png');
const splashText = require('./assets/tpc-text.png');
const splashFinal = require('./assets/tpc-final.png');
const AUTH_TRACE = false;
const SIGNED_OUT_CONFIRM_DELAY_MS = 700;
const IS_EXPO_GO = Constants.appOwnership === 'expo';

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
    <HomeStack.Navigator screenOptions={{ headerShown: false, gestureEnabled: !AFFECTED_IOS }}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
      <HomeStack.Screen name="Finder" component={FinderScreen} />
    </HomeStack.Navigator>
  );
}

function BoardsStackNavigator() {
  return (
    <BoardsStack.Navigator screenOptions={{ headerShown: false, gestureEnabled: !AFFECTED_IOS }}>
      <BoardsStack.Screen name="BoardsMain" component={BoardsScreen} />
      <BoardsStack.Screen name="BoardDetail" component={BoardDetailScreen} />
    </BoardsStack.Navigator>
  );
}

function AIStackNavigator() {
  return (
    <AIStack.Navigator screenOptions={{ headerShown: false, gestureEnabled: !AFFECTED_IOS }}>
      <AIStack.Screen name="AIHub"      component={AIHubScreen} />
      <AIStack.Screen name="Advisor"    component={AdvisorScreen} />
      <AIStack.Screen name="Finder"     component={FinderScreen} />
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
        lazy: true,          // defer mounting until first visit — cuts startup time
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabel: ({ color }) => (
          <Text allowFontScaling={false} style={[styles.tabLabel, { color }]}>
            {route.name}
          </Text>
        ),
        tabBarIcon: ({ focused, color, size }) => {
          const iconMap: Record<string, [string, string]> = {
            Home:     ['home',              'home-outline'],
            Vault:    ['file-tray-full',    'file-tray-full-outline'],
            Boards:   ['grid',              'grid-outline'],
            Videos:   ['play-circle',       'play-circle-outline'],
            'TPC.ai': ['sparkles',          'sparkles-outline'],
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
    ownedPedals, wishlistPedals, totalMarketValue,
  } = useStore();
  const [initialized, setInitialized] = useState(false);
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [showPostOnboarding, setShowPostOnboarding] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  const [fontsLoaded] = useFonts({
    RuckSackBlack: require('./assets/fonts/RuckSackBlack.otf'),
    SpaceGrotesk_700Bold,   // kept as fallback
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  // ── Deep link handler (email verification + OAuth fallback) ─────────────────
  // When the user taps the confirmation email link, iOS opens the app at
  // tpc://auth-callback with tokens in the hash fragment or a PKCE code in
  // the query string. We process whichever we get.
  useEffect(() => {
    const handleUrl = async (url: string) => {
      // Public profile deep link: tpc://profile/username
      if (url.startsWith('tpc://profile/')) {
        const username = url.replace('tpc://profile/', '').split('?')[0].trim();
        if (username && navigationRef.current?.isReady()) {
          (navigationRef.current as any).navigate('PublicProfile', { username });
        }
        return;
      }

      if (!url.startsWith('tpc://auth-callback')) return;

      // Email verification → hash fragment: #access_token=...&refresh_token=...
      const hash = url.includes('#') ? url.split('#')[1] : '';
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      if (accessToken && refreshToken) {
        const { data } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (data.session) setSession(data.session);
        return;
      }

      // PKCE OAuth → query param: ?code=...
      const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
      const code = new URLSearchParams(query).get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          const { data: sd } = await supabase.auth.getSession();
          if (sd.session) setSession(sd.session);
        }
      }
    };

    // Cold start — app opened via deep link while it was terminated
    Linking.getInitialURL().then(url => { if (url) handleUrl(url); });

    // Warm — app already running when link is tapped
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  // First-run welcome onboarding — shown only once, before login
  useEffect(() => {
    AsyncStorage.getItem('tpc_welcome_shown').then(val => {
      if (!val) setShowWelcome(true);
    });
  }, []);

  const dismissWelcome = () => {
    setShowWelcome(false);
    AsyncStorage.setItem('tpc_welcome_shown', '1');
  };

  // Bootstrap Supabase auth
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        const msg = String(error.message ?? '');
        if (msg.toLowerCase().includes('refresh token')) {
          // The stored refresh token is invalid or not found on the server —
          // this is not transient. Clear local session so the user sees the
          // login screen cleanly instead of being stuck in a broken auth state.
          if (__DEV__) console.warn('[Auth] Invalid refresh token — clearing local session');
          await supabase.auth.signOut({ scope: 'local' });
          setSession(null);
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
      if (__DEV__ && AUTH_TRACE) {
        console.warn('[AuthTrace] onAuthStateChange', {
          event,
          hasSession: !!session,
          userId: session?.user?.id ?? null,
        });
      }
      if (event === 'SIGNED_OUT') {
        // Expo Go auth state can churn and emit false SIGNED_OUT events.
        // Ignore auto SIGNED_OUT in Expo Go; explicit in-app Sign Out still clears state.
        if (IS_EXPO_GO) {
          if (__DEV__ && AUTH_TRACE) {
            console.warn('[Auth] Ignoring SIGNED_OUT in Expo Go');
          }
          return;
        }

        // Expo Go can emit transient SIGNED_OUT during token churn.
        // Confirm twice + attempt one refresh before clearing app state.
        setTimeout(async () => {
          try {
            const { data: first } = await supabase.auth.getSession();
            if (first.session?.user) return;

            const { data: refreshed } = await supabase.auth.refreshSession();
            if (refreshed.session?.user) {
              setSession(refreshed.session);
              return;
            }

            const { data: second } = await supabase.auth.getSession();
            if (second.session?.user) {
              setSession(second.session);
              return;
            }
            setSession(null);
          } catch {
            setSession(null);
          }
        }, SIGNED_OUT_CONFIRM_DELAY_MS);
        return;
      }
      // Guard against transient null sessions emitted on non-signout events.
      // We only clear on explicit SIGNED_OUT.
      if (session?.user) {
        setSession(session);
      } else if (__DEV__ && AUTH_TRACE) {
        console.warn('[Auth] Ignoring non-signed-out auth event with null session:', event);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (__DEV__ && AUTH_TRACE) {
      console.warn('[AuthTrace] App session state', {
        hasSession: !!session,
        userId: session?.user?.id ?? null,
      });
    }
  }, [session?.user?.id, session]);

  // Hide the native splash immediately on first mount so only our
  // AnimatedSplash is visible — avoids a flash of the native splash icon
  // before the JS animation kicks in.
  // On iOS 26.0–26.5, hideAsync() is the same void TurboModule call as
  // preventAutoHideAsync() (guarded above) — it aborts the process via ObjC
  // exception on a background GCD thread. Skip it: preventAutoHideAsync was
  // never called on affected versions, so the splash auto-hides on its own.
  useEffect(() => {
    if (AFFECTED_IOS) return;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Load profile whenever a user signs in. is_premium from the DB is the
  // source of truth — Patreon, manual grants, and (future) purchase webhooks
  // all write there. Awaiting fetchProfile first means the Pro gate is
  // resolved before any screen renders, so Pro users never see a paywall flash.
  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    (async () => {
      await fetchProfile();
      // Notification native module calls UIKit void methods via TurboModule on
      // background threads — skip entirely on iOS 26.0–26.5.
      if (AFFECTED_IOS) return;
      const granted = await requestNotificationPermissions();
      if (!granted) return;
      scheduleWeeklyPickNotification().catch(() => {});
      savePushToken(userId).catch(() => {});
    })();
  }, [session?.user?.id]);

  // Open AWIN-wrapped listing links when the user taps a price-drop push.
  // (No-op on iOS 26.0–26.5 — registration is a native call.)
  useEffect(() => {
    return addNotificationOpenHandler(url => {
      Linking.openURL(url).catch(() => {});
    });
  }, []);

  // Keep the weekly vault digest content in sync with live collection/value.
  useEffect(() => {
    if (AFFECTED_IOS) return;
    if (!session?.user?.id) return;
    scheduleVaultDigestNotification(ownedPedals.length, totalMarketValue).catch(() => {});
  }, [session?.user?.id, ownedPedals.length, totalMarketValue]);

  // Cancel notifications on sign-out
  useEffect(() => {
    if (AFFECTED_IOS) return;
    if (!session) {
      cancelAllTpcNotifications().catch(() => {});
    }
  }, [session]);

  // Re-engagement notification — reset 4-day clock every time app comes to foreground
  useEffect(() => {
    if (AFFECTED_IOS) return;
    if (!session) return;
    // Schedule immediately on mount (first open of the session)
    scheduleReengagementNotification(wishlistPedals.length).catch(() => {});
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        scheduleReengagementNotification(wishlistPedals.length).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [session, wishlistPedals.length]);

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

  // Only build the real app tree once fonts + auth are both ready.
  // AnimatedSplash covers the screen until then so no content flash.
  const baseContent = (!fontsLoaded || !initialized) ? null : !session ? (
    showWelcome ? (
      <WelcomeOnboarding
        onGetStarted={dismissWelcome}
        onSignIn={dismissWelcome}
        onShowLegal={(tab) => {
          if (navigationRef.isReady()) {
            (navigationRef.navigate as any)('Legal', { tab });
          }
        }}
      />
    ) : (
      <AuthScreen />
    )
  ) : (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false, gestureEnabled: !AFFECTED_IOS }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen
          name="Admin"
          component={AdminScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="GearHistory"
          component={GearHistoryScreen}
          options={{ animation: 'slide_from_right', gestureEnabled: !AFFECTED_IOS }}
        />
        <Stack.Screen
          name="ChatHistory"
          component={ChatHistoryScreen}
          options={{ animation: 'slide_from_right', gestureEnabled: !AFFECTED_IOS }}
        />
        <Stack.Screen
          name="Legal"
          component={LegalScreen}
          options={{ animation: 'slide_from_right', gestureEnabled: !AFFECTED_IOS }}
        />
        <Stack.Screen
          name="PublicProfile"
          component={PublicProfileScreen}
          options={{ animation: 'slide_from_right', gestureEnabled: !AFFECTED_IOS }}
        />
        <Stack.Screen
          name="AccountSettings"
          component={AccountSettingsScreen}
          options={{ animation: 'slide_from_right', gestureEnabled: !AFFECTED_IOS }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );

  // On iOS 26.0–26.5, SafeAreaProvider calls native UIKit methods via the
  // TurboModule interop layer on a background thread. This throws an ObjC
  // exception that aborts the process (crash in performVoidMethodInvocation).
  // Apple fixed this in 26.6. Use a plain View with manual status-bar padding
  // as a fallback so the app opens on affected devices.
  const appInner = (
    <>
      {/* StatusBar drives RCTStatusBarManager.setStyle — a UIKit void method
          with the same iOS 26.0–26.5 TurboModule abort. Skip on affected
          versions; the bar renders with default styling there. */}
      {!AFFECTED_IOS && <StatusBar style="light" />}
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
                  // Navigate into Expert Mode (Custom Shop) after modal closes
                  setTimeout(() => {
                    if (navigationRef.isReady()) {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (navigationRef.navigate as any)(
                        'Main',
                        { screen: 'TPC.ai', params: { screen: 'Finder', params: { startMode: 'expert' } } },
                      );
                    }
                  }, 350);
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
    </>
  );

  // On iOS 26.0–26.5, both GestureHandlerRootView.install() and
  // SafeAreaProvider dispatch void TurboModule methods on background GCD
  // threads, which aborts the process. Skip both on affected versions.
  if (AFFECTED_IOS) {
    return (
      <View style={{ flex: 1, paddingTop: Constants.statusBarHeight }}>
        {appInner}
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {appInner}
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
