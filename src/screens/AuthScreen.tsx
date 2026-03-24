import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import { makeRedirectUri } from 'expo-auth-session';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';
import { supabase } from '../lib/supabase';

// Required for expo-auth-session to handle the redirect on iOS
WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

const REDIRECT_URI = makeRedirectUri({ scheme: 'tpc', path: 'auth-callback' });

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
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
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (err) {
      failedAttempts.current += 1;
      if (failedAttempts.current >= MAX_ATTEMPTS) {
        lockoutUntil.current = Date.now() + LOCKOUT_MS;
        failedAttempts.current = 0;
        setError(getLockoutMessage());
      } else {
        setError('Invalid email or password. Please try again.');
      }
    } else {
      failedAttempts.current = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
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
    const { error: err } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (err) setError('Unable to create account. Please try again.');
    else {
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

      if (oauthErr || !data.url) {
        setError('Google sign-in is not set up yet. Check Supabase dashboard.');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URI);

      if (result.type === 'success' && result.url) {
        // Supabase OAuth can return either:
        // 1) PKCE code in query string (?code=...), or
        // 2) access_token/refresh_token in hash fragment (#access_token=...)
        const url = new URL(result.url);
        const queryParams = new URLSearchParams(url.search ? url.search.slice(1) : '');
        const code = queryParams.get('code');

        if (code) {
          const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeErr) {
            setError(`Google sign-in failed: ${exchangeErr.message}`);
            return;
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }

        const hashParams = new URLSearchParams(url.hash ? url.hash.slice(1) : '');
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error: sessionErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionErr) {
            setError(`Google sign-in failed: ${sessionErr.message}`);
            return;
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }

        setError('Google sign-in failed: no auth code or token returned.');
      }
    } catch {
      setError('Google sign-in failed. Please try again.');
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
                <LinearGradient colors={gradients.teal} style={styles.modeTabGrad}>
                  <Text style={styles.modeTabTextActive}>
                    {m === 'signin' ? 'Sign In' : 'Create Account'}
                  </Text>
                </LinearGradient>
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
          <Text style={styles.footerText}>
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  modeTabGrad: {
    width: '100%',
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
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
});
