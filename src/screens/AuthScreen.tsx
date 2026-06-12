import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import { makeRedirectUri } from 'expo-auth-session';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';
import { supabase } from '../lib/supabase';
import { useStore } from '../hooks/useStore';

// Required for expo-auth-session to handle the redirect on iOS
WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const FUNCTIONS_URL = 'https://skejiotfywhmnvsivfsk.supabase.co/functions/v1';

// In Expo SDK 54, appOwnership === 'expo' is the reliable Expo Go signal.
// executionEnvironment is no longer a stable discriminator across SDK versions.
const IS_EXPO_GO = Constants.appOwnership === 'expo';

const EXPO_OWNER = (Constants.expoConfig?.owner as string | undefined) ?? 'alanbennettjohnson';
const EXPO_SLUG = (Constants.expoConfig?.slug as string | undefined) ?? 'tpc-app';
const EXPO_PROXY_REDIRECT_URI = `https://auth.expo.io/@${EXPO_OWNER}/${EXPO_SLUG}`;

// Production/TestFlight: tpc://auth-callback (must be in Supabase → Auth → URL Configuration → Redirect URLs)
// Expo Go: auth.expo.io proxy (must also be in the allowlist)
const REDIRECT_URI = IS_EXPO_GO
  ? EXPO_PROXY_REDIRECT_URI
  : makeRedirectUri({ scheme: 'tpc', path: 'auth-callback' });

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const setSession = useStore((s) => s.setSession);
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOAuthLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState('');
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  // Rate limiting refs — not state so they don't cause re-renders
  const failedAttempts = useRef(0);
  const lockoutUntil = useRef<number>(0);

  const isLockedOut = () => Date.now() < lockoutUntil.current;

  const getLockoutMessage = () => {
    const remaining = Math.ceil((lockoutUntil.current - Date.now()) / 1000 / 60);
    return `Too many failed attempts. Please wait ${remaining} minute${remaining !== 1 ? 's' : ''} before trying again.`;
  };

  // ── Email/password sign in ────────────────────────────────────────────────

  const handleSignIn = async () => {
    // Client-side lockout is a fast first-pass; server enforces the real limit.
    if (isLockedOut()) { setError(getLockoutMessage()); return; }
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    setError('');

    let res: Response;
    let authData: Record<string, unknown>;
    try {
      res = await fetch(`${FUNCTIONS_URL}/auth-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      authData = await res.json();
    } catch {
      setLoading(false);
      setError('Network error. Please check your connection and try again.');
      return;
    }

    if (res.status === 429) {
      setLoading(false);
      setError((authData.error as string) ?? 'Too many failed attempts. Please wait before trying again.');
      return;
    }

    if (!res.ok || !authData.access_token) {
      setLoading(false);
      failedAttempts.current += 1;
      if (failedAttempts.current >= MAX_ATTEMPTS) {
        lockoutUntil.current = Date.now() + LOCKOUT_MS;
        failedAttempts.current = 0;
        setError(getLockoutMessage());
      } else {
        setError('Invalid email or password. Please try again.');
      }
      return;
    }

    // Set session from the tokens the Edge Function proxied back.
    const { data: sessionData, error: sessionErr } = await supabase.auth.setSession({
      access_token:  authData.access_token as string,
      refresh_token: authData.refresh_token as string,
    });
    setLoading(false);

    if (sessionErr || !sessionData.session) {
      setError('Sign in failed. Please try again.');
      return;
    }

    setSession(sessionData.session);
    failedAttempts.current = 0;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        // Deep-link back into the app after the user taps "Confirm your email".
        // Must also be listed in Supabase → Auth → URL Configuration → Redirect URLs.
        emailRedirectTo: 'tpc://auth-callback',
      },
    });
    setLoading(false);
    if (err) {
      const msg = err.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        setError('That email already has an account. Tap Sign In instead.');
      } else if (msg.includes('password')) {
        setError(err.message);
      } else if (msg.includes('email')) {
        setError(err.message);
      } else {
        setError(`Unable to create account: ${err.message}`);
      }
    }
    else {
      if (data.session) setSession(data.session);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSignUpSuccess(true);
    }
  };

  // ── Google OAuth ──────────────────────────────────────────────────────────

  const handleGoogleSignIn = async () => {
    try {
      setOAuthLoading('google');
      setError('');
      Haptics.selectionAsync();

      const { data, error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: REDIRECT_URI,
          skipBrowserRedirect: true,
        },
      });

      if (oauthErr || !data?.url) {
        setError('Google sign-in failed to start. Please try again.');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URI);

      // User tapped Cancel — not an error
      if (result.type === 'cancel' || result.type === 'dismiss') {
        return;
      }

      if (result.type !== 'success' || !result.url) {
        setError('Google sign-in was not completed. Please try again.');
        return;
      }

      // PKCE flow: extract ?code= and exchange for session.
      // flowType: 'pkce' is set on the Supabase client so this is always PKCE.
      const url = new URL(result.url);
      const code = new URLSearchParams(url.search).get('code');

      if (!code) {
        // Shouldn't happen with PKCE, but surface a clear error if it does.
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
        const errorDesc = hashParams.get('error_description') ?? url.searchParams.get('error_description') ?? 'no auth code returned';
        setError(`Google sign-in failed: ${errorDesc}. Please try again.`);
        return;
      }

      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeErr) {
        setError(`Google sign-in failed: ${exchangeErr.message}`);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) setSession(sessionData.session);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(`Google sign-in failed: ${msg}`);
    } finally {
      setOAuthLoading(null);
    }
  };

  // ── Apple Sign In ─────────────────────────────────────────────────────────

  const handleAppleSignIn = async () => {
    try {
      setOAuthLoading('apple');
      setError('');

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      const { identityToken } = credential;
      if (!identityToken) {
        setError('Apple sign-in failed — no identity token returned.');
        return;
      }

      const { error: idErr } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: identityToken,
      });

      if (idErr) {
        setError('Apple sign-in failed. Make sure Apple is enabled in Supabase.');
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) setSession(sessionData.session);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: unknown) {
      // User cancelled is not an error
      const code = (e as { code?: string })?.code;
      if (code !== 'ERR_REQUEST_CANCELED') {
        setError('Apple sign-in failed. Please try again.');
      }
    } finally {
      setOAuthLoading(null);
    }
  };

  const switchMode = (newMode: Mode) => {
    Haptics.selectionAsync();
    setMode(newMode);
    setError('');
    setSignUpSuccess(false);
  };

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={24}
    >
        {/* ── Logo ── */}
        <View style={styles.logoSection}>
          <Image
            source={require('../../assets/tpc-final.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.tagline}>Track. Discover. Connect.</Text>
        </View>

        {/* ── Social sign-in ── */}
        <View style={styles.socialRow}>
          {/* Sign in with Apple (iOS only) */}
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={styles.socialBtn}
              onPress={handleAppleSignIn}
              disabled={oauthLoading !== null}
              activeOpacity={0.85}
            >
              {oauthLoading === 'apple' ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <>
                  <Ionicons name="logo-apple" size={20} color={colors.textPrimary} />
                  <Text style={styles.socialBtnText}>Continue with Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Sign in with Google */}
          {!IS_EXPO_GO ? (
            <TouchableOpacity
              style={styles.socialBtn}
              onPress={handleGoogleSignIn}
              disabled={oauthLoading !== null}
              activeOpacity={0.85}
            >
              {oauthLoading === 'google' ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <>
                  <GoogleIcon />
                  <Text style={styles.socialBtnText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <Text style={styles.socialHint}>Google sign-in is disabled in Expo Go. Use email for testing.</Text>
          )}
        </View>

        {/* ── Divider ── */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* ── Mode Tabs ── */}
        <View style={styles.modeTabs}>
          {(['signin', 'signup'] as const).map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.modeTab, mode === m && styles.modeTabActive]}
              onPress={() => switchMode(m)}
              activeOpacity={0.75}
            >
              {mode === m ? (
                <>
                  <LinearGradient
                    colors={gradients.teal}
                    style={StyleSheet.absoluteFillObject}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  />
                  <Text style={styles.modeTabTextActive}>
                    {m === 'signin' ? 'Sign In' : 'Create Account'}
                  </Text>
                </>
              ) : (
                <Text style={styles.modeTabText}>
                  {m === 'signin' ? 'Sign In' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Sign-up success ── */}
        {signUpSuccess ? (
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>📬</Text>
            <Text style={styles.successTitle}>Check your email!</Text>
            <Text style={styles.successText}>
              We sent a confirmation link to {email}. Click it to activate your account, then sign in.
            </Text>
            <TouchableOpacity
              style={styles.switchToSignIn}
              onPress={() => switchMode('signin')}
            >
              <Text style={styles.switchToSignInText}>Go to Sign In →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* ── Email/password form ── */
          <View style={styles.form}>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Email</Text>
              <TextInput
                style={styles.formInput}
                value={email}
                onChangeText={v => { setEmail(v); setError(''); }}
                placeholder="your@email.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.formLabel}>Password</Text>
              <TextInput
                style={styles.formInput}
                value={password}
                onChangeText={v => { setPassword(v); setError(''); }}
                placeholder={mode === 'signup' ? 'At least 12 characters' : '••••••••'}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={mode === 'signin' ? handleSignIn : handleSignUp}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={mode === 'signin' ? handleSignIn : handleSignUp}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient colors={gradients.teal} style={styles.submitBtn}>
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {mode === 'signin' ? 'Sign In' : 'Create Account'}
                  </Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {mode === 'signin' && (
              <TouchableOpacity style={styles.forgotLink} disabled>
                <Text style={styles.forgotLinkText}>Forgot password? (coming soon)</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>By continuing, you agree to our{' '}
            <Text
              style={styles.footerLink}
              onPress={() => WebBrowser.openBrowserAsync('https://skejiotfywhmnvsivfsk.supabase.co/storage/v1/object/public/legal/terms-of-service.html')}
            >Terms of Service</Text>
            {' '}and{' '}
            <Text
              style={styles.footerLink}
              onPress={() => WebBrowser.openBrowserAsync('https://skejiotfywhmnvsivfsk.supabase.co/storage/v1/object/public/legal/privacy-policy.html')}
            >Privacy Policy</Text>.
          </Text>
        </View>
    </KeyboardAwareScrollView>
  );
}

// ─── Google "G" icon (SVG-free inline) ───────────────────────────────────────
function GoogleIcon() {
  return (
    <View style={googleIconStyles.container}>
      <Text style={googleIconStyles.text}>G</Text>
    </View>
  );
}

const googleIconStyles = StyleSheet.create({
  container: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4285F4',
    lineHeight: 16,
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.base,
    paddingBottom: 48,
    gap: spacing.xl,
  },
  // Logo
  logoSection: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  logoImage: {
    width: 220,
    height: 100,
  },
  tagline: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  // Social sign-in buttons
  socialRow: {
    gap: spacing.sm,
  },
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    height: 52,
    paddingHorizontal: spacing.base,
  },
  socialBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
  },
  socialHint: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  // Mode tabs
  modeTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
  },
  modeTab: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabActive: {},
  modeTabText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    paddingVertical: spacing.sm,
  },
  modeTabTextActive: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  // Form
  form: {
    gap: spacing.base,
  },
  formField: {
    gap: spacing.sm,
  },
  formLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  formInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    height: 52,
  },
  errorBox: {
    backgroundColor: colors.error + '18',
    borderWidth: 1,
    borderColor: colors.error + '50',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  errorText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.error,
    textAlign: 'center',
  },
  submitBtn: {
    borderRadius: radius.lg,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  forgotLink: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
  },
  forgotLinkText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  // Success
  successCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  successEmoji: {
    fontSize: 48,
  },
  successTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  successText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  switchToSignIn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.teal + '60',
  },
  switchToSignInText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  // Footer
  footer: {
    paddingTop: spacing.sm,
  },
  footerText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  footerLink: {
    color: colors.teal,
    textDecorationLine: 'underline',
  },
});
