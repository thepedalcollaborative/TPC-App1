// Account Settings — username, email, and password management.
// Email and password sections are hidden for Apple Sign In users
// since those credentials are managed by Apple, not TPC.

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, typography, spacing, radius } from '../theme';
import { supabase } from '../lib/supabase';
import { useStore } from '../hooks/useStore';

type Section = 'username' | 'email' | 'password' | null;

export default function AccountSettingsScreen() {
  const navigation = useNavigation();
  const { session, profile, fetchProfile } = useStore();

  const provider = session?.user?.app_metadata?.provider;
  const isOAuthUser = provider === 'apple' || provider === 'google';
  const isAppleUser = provider === 'apple';

  const [activeSection, setActiveSection] = useState<Section>(null);

  // Username
  const [usernameInput, setUsernameInput] = useState(profile?.username ?? '');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState(false);

  // Email
  const [emailInput, setEmailInput] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const openSection = useCallback((section: Section) => {
    Haptics.selectionAsync();
    setActiveSection(prev => prev === section ? null : section);
    setUsernameError('');
    setEmailError('');
    setPasswordError('');
    setUsernameSuccess(false);
    setEmailSuccess(false);
    setPasswordSuccess(false);
    if (section === 'username') setUsernameInput(profile?.username ?? '');
    if (section === 'email') setEmailInput('');
    if (section === 'password') {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [profile?.username]);

  // ── Username save ────────────────────────────────────────────────────────────
  const handleSaveUsername = async () => {
    const trimmed = usernameInput.trim().toLowerCase();
    if (!trimmed) { setUsernameError('Username cannot be empty.'); return; }

    setUsernameLoading(true);
    setUsernameError('');

    const { data, error } = await supabase.rpc('claim_username', { p_username: trimmed });

    setUsernameLoading(false);

    if (error || !data?.ok) {
      const code = data?.error ?? 'unknown';
      if (code === 'taken') setUsernameError('That username is already taken.');
      else if (code === 'invalid') setUsernameError('3–20 characters, letters, numbers, and underscores only.');
      else setUsernameError('Something went wrong. Please try again.');
      return;
    }

    await fetchProfile();
    setUsernameSuccess(true);
    setTimeout(() => {
      setUsernameSuccess(false);
      setActiveSection(null);
    }, 1500);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // ── Email save ───────────────────────────────────────────────────────────────
  const handleSaveEmail = async () => {
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setEmailError('Enter a valid email address.');
      return;
    }
    if (trimmed === session?.user?.email?.toLowerCase()) {
      setEmailError('That\'s already your current email.');
      return;
    }

    setEmailLoading(true);
    setEmailError('');

    const { error } = await supabase.auth.updateUser({ email: trimmed });

    setEmailLoading(false);

    if (error) {
      setEmailError(error.message ?? 'Could not update email. Please try again.');
      return;
    }

    setEmailSuccess(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // ── Password save ────────────────────────────────────────────────────────────
  const handleSavePassword = async () => {
    if (!currentPassword) { setPasswordError('Enter your current password.'); return; }
    if (newPassword.length < 8) { setPasswordError('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('New passwords don\'t match.'); return; }

    setPasswordLoading(true);
    setPasswordError('');

    // Re-authenticate to verify current password
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: session?.user?.email ?? '',
      password: currentPassword,
    });

    if (signInError) {
      setPasswordLoading(false);
      setPasswordError('Current password is incorrect.');
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    setPasswordLoading(false);

    if (updateError) {
      setPasswordError(updateError.message ?? 'Could not update password. Please try again.');
      return;
    }

    setPasswordSuccess(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => {
      setPasswordSuccess(false);
      setActiveSection(null);
    }, 1500);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Nav */}
      <View style={styles.nav}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Account Settings</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Username ── */}
        <Text style={styles.sectionLabel}>USERNAME</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => openSection('username')}
            activeOpacity={0.75}
          >
            <Ionicons name="at-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Username</Text>
              <Text style={styles.rowValue} numberOfLines={1}>
                {profile?.username ? `@${profile.username}` : 'Not set'}
              </Text>
            </View>
            <Ionicons
              name={activeSection === 'username' ? 'chevron-up' : 'chevron-forward'}
              size={16}
              color={colors.textMuted}
            />
          </TouchableOpacity>

          {activeSection === 'username' && (
            <View style={styles.editArea}>
              <View style={styles.inputRow}>
                <Text style={styles.inputPrefix}>@</Text>
                <TextInput
                  style={styles.inputInner}
                  value={usernameInput}
                  onChangeText={t => { setUsernameInput(t.toLowerCase()); setUsernameError(''); }}
                  placeholder="yourname"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  returnKeyType="done"
                  onSubmitEditing={handleSaveUsername}
                />
              </View>
              <Text style={styles.hint}>3–20 characters. Letters, numbers, and underscores only.</Text>
              {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}
              {usernameSuccess ? <Text style={styles.successText}>Username saved!</Text> : null}
              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => openSection(null)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSaveUsername}
                  disabled={usernameLoading}
                >
                  {usernameLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.saveBtnText}>Save</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* ── Email (non-Apple only) ── */}
        {!isOAuthUser && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>EMAIL</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => openSection('email')}
                activeOpacity={0.75}
              >
                <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Email Address</Text>
                  <Text style={styles.rowValue} numberOfLines={1}>
                    {session?.user?.email ?? '—'}
                  </Text>
                </View>
                <Ionicons
                  name={activeSection === 'email' ? 'chevron-up' : 'chevron-forward'}
                  size={16}
                  color={colors.textMuted}
                />
              </TouchableOpacity>

              {activeSection === 'email' && (
                <View style={styles.editArea}>
                  {emailSuccess ? (
                    <View style={styles.successCard}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
                      <Text style={styles.successCardText}>
                        Confirmation emails sent to your old and new address. Check your inbox to complete the change.
                      </Text>
                    </View>
                  ) : (
                    <>
                      <TextInput
                        style={styles.input}
                        value={emailInput}
                        onChangeText={t => { setEmailInput(t); setEmailError(''); }}
                        placeholder="new@email.com"
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        returnKeyType="done"
                        onSubmitEditing={handleSaveEmail}
                      />
                      <Text style={styles.hint}>
                        You'll receive confirmation emails at both your old and new address.
                      </Text>
                      {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
                      <View style={styles.btnRow}>
                        <TouchableOpacity style={styles.cancelBtn} onPress={() => openSection(null)}>
                          <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.saveBtn}
                          onPress={handleSaveEmail}
                          disabled={emailLoading}
                        >
                          {emailLoading
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={styles.saveBtnText}>Save</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          </>
        )}

        {/* ── Password (non-Apple only) ── */}
        {!isOAuthUser && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>PASSWORD</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => openSection('password')}
                activeOpacity={0.75}
              >
                <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Password</Text>
                  <Text style={styles.rowValue}>••••••••</Text>
                </View>
                <Ionicons
                  name={activeSection === 'password' ? 'chevron-up' : 'chevron-forward'}
                  size={16}
                  color={colors.textMuted}
                />
              </TouchableOpacity>

              {activeSection === 'password' && (
                <View style={styles.editArea}>
                  {passwordSuccess ? (
                    <View style={styles.successCard}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
                      <Text style={styles.successCardText}>Password updated successfully.</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.inputLabel}>Current Password</Text>
                      <TextInput
                        style={styles.input}
                        value={currentPassword}
                        onChangeText={t => { setCurrentPassword(t); setPasswordError(''); }}
                        placeholder="Current password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                      />
                      <Text style={[styles.inputLabel, { marginTop: spacing.sm }]}>New Password</Text>
                      <TextInput
                        style={styles.input}
                        value={newPassword}
                        onChangeText={t => { setNewPassword(t); setPasswordError(''); }}
                        placeholder="At least 8 characters"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                      />
                      <Text style={[styles.inputLabel, { marginTop: spacing.sm }]}>Confirm New Password</Text>
                      <TextInput
                        style={styles.input}
                        value={confirmPassword}
                        onChangeText={t => { setConfirmPassword(t); setPasswordError(''); }}
                        placeholder="Repeat new password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={handleSavePassword}
                      />
                      {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
                      <View style={styles.btnRow}>
                        <TouchableOpacity style={styles.cancelBtn} onPress={() => openSection(null)}>
                          <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.saveBtn}
                          onPress={handleSavePassword}
                          disabled={passwordLoading}
                        >
                          {passwordLoading
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={styles.saveBtnText}>Save</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          </>
        )}

        {isOAuthUser && (
          <Text style={styles.appleNote}>
            Signed in with {isAppleUser ? 'Apple' : 'Google'}. Email and password are managed by your {isAppleUser ? 'Apple ID' : 'Google account'} — make changes there instead.
          </Text>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  backBtn: { width: 32 },
  scroll: { padding: spacing.base, paddingBottom: 60 },

  sectionLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
  },
  rowLabel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  rowValue: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: 2,
  },

  editArea: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.base,
    gap: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.teal + '60',
    paddingHorizontal: spacing.md,
  },
  inputPrefix: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    marginRight: 2,
  },
  inputLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  // Standalone input (email, password fields)
  input: {
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.teal + '60',
    paddingHorizontal: spacing.md,
  },
  // Username input inside inputRow — no border, no background
  inputInner: {
    flex: 1,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  hint: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    lineHeight: 16,
  },
  errorText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.rose,
  },
  successText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  successCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.teal + '12',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  successCardText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  saveBtn: {
    flex: 2,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.teal,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  appleNote: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
