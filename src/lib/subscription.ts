/**
 * TPC Subscription layer
 *
 * Tracks free-tier usage in AsyncStorage and provides gate checks.
 * The `isPro` boolean comes from profile.is_premium (synced from Supabase).
 *
 * ── RevenueCat integration (Phase 2) ────────────────────────────────────────
 * When ready to wire real purchases:
 *   1. npx expo install react-native-purchases
 *   2. Add to app.json plugins: ["react-native-purchases", { "apiKey": "appl_xxxx" }]
 *   3. Replace purchasePro() stub below with real Purchases.purchasePackage() call
 *   4. Configure RevenueCat webhook → Supabase function → update user_profiles.is_premium
 *   5. On app launch, call Purchases.configure() + sync entitlement to profile
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// ─── RevenueCat config ────────────────────────────────────────────────────────
const extra =
  Constants.expoConfig?.extra ??
  (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra ??
  (Constants as unknown as { expoGoConfig?: { extra?: Record<string, unknown> } }).expoGoConfig?.extra ??
  {};

const RC_API_KEY = (
  (extra as Record<string, unknown> | undefined)?.revenueCatApiKey as string
) ?? '';
const BETA_FULL_ACCESS = Boolean(
  (extra as Record<string, unknown> | undefined)?.betaFullAccess
);
const ENTITLEMENT_ID = 'pro'; // must match the entitlement key in RevenueCat dashboard

export function hasBetaFullAccess(): boolean {
  return BETA_FULL_ACCESS;
}

function isExpoGoRuntime(): boolean {
  return (Constants as { appOwnership?: string }).appOwnership === 'expo';
}

/**
 * Call once on app launch (after session is available).
 * Logs in with the Supabase userId so purchases survive reinstalls.
 */
export function configureRevenueCat(userId?: string): void {
  if (!RC_API_KEY || RC_API_KEY === 'YOUR_REVENUECAT_API_KEY') {
    if (__DEV__) console.warn('[TPC] RevenueCat: set revenueCatApiKey in app.json extra');
    return;
  }
  // Expo Go cannot use native IAP with production SDK keys.
  // Keep dev flow clean by skipping RevenueCat setup there.
  if (isExpoGoRuntime() && RC_API_KEY.startsWith('appl_')) {
    if (__DEV__) {
      console.log('[TPC] RevenueCat skipped in Expo Go (production key). Use a dev build for purchases.');
    }
    return;
  }
  try {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey: RC_API_KEY });
    if (userId) Purchases.logIn(userId);
  } catch (err) {
    if (__DEV__) console.warn('[TPC] RevenueCat configure error:', err);
  }
}

/**
 * Sync the RevenueCat entitlement to Supabase. Call on app launch after configure.
 * Returns true if the user is currently Pro.
 */
export async function syncEntitlement(userId: string): Promise<boolean> {
  try {
    const info = await Purchases.getCustomerInfo();
    const isPro = !!info.entitlements.active[ENTITLEMENT_ID];
    await supabase.from('user_profiles').update({ is_premium: isPro }).eq('id', userId);
    return isPro;
  } catch { return false; }
}

// ─── Free-tier limits ─────────────────────────────────────────────────────────
export const FREE_ADVISOR_MESSAGES_PER_MONTH = 5;
export const FREE_CUSTOM_SHOP_RUNS_LIFETIME  = 1;
export const FREE_BOARDS_LIMIT               = 2;

// ─── Pricing display ─────────────────────────────────────────────────────────
export const PRICE_MONTHLY         = '$5.99';
export const PRICE_ANNUAL          = '$49.99';
export const PRICE_ANNUAL_MONTHLY  = '$4.17';
export const PRICE_ANNUAL_SAVINGS  = '30%';

// ─── AsyncStorage keys ────────────────────────────────────────────────────────
function advisorMonthKey(): string {
  const d = new Date();
  return `tpc_advisor_${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const CUSTOM_SHOP_KEY  = 'tpc_custom_shop_runs';
const MILESTONE_KEY    = 'tpc_milestones_shown'; // JSON: number[]
const LAST_PICK_KEY    = 'tpc_last_custom_shop_pick'; // JSON: LastPick

export type LastPick = {
  brand: string;
  model: string;
  why: string;
  timestamp: string;
};

// ─── Advisor ──────────────────────────────────────────────────────────────────
export async function getAdvisorMessageCount(): Promise<number> {
  try {
    const val = await AsyncStorage.getItem(advisorMonthKey());
    return val ? parseInt(val, 10) : 0;
  } catch { return 0; }
}

export async function incrementAdvisorCount(): Promise<void> {
  try {
    const count = await getAdvisorMessageCount();
    await AsyncStorage.setItem(advisorMonthKey(), String(count + 1));
  } catch {}
}

export async function advisorGate(isPro: boolean): Promise<{
  allowed: boolean;
  remaining: number;
  showWarning: boolean;
}> {
  if (isPro || BETA_FULL_ACCESS) return { allowed: true, remaining: Infinity, showWarning: false };
  const count = await getAdvisorMessageCount();
  const remaining = Math.max(0, FREE_ADVISOR_MESSAGES_PER_MONTH - count);
  return {
    allowed: remaining > 0,
    remaining,
    showWarning: remaining === 1,
  };
}

// ─── Custom Shop ──────────────────────────────────────────────────────────────
export async function getCustomShopRunCount(): Promise<number> {
  try {
    const val = await AsyncStorage.getItem(CUSTOM_SHOP_KEY);
    return val ? parseInt(val, 10) : 0;
  } catch { return 0; }
}

export async function incrementCustomShopCount(): Promise<void> {
  try {
    const count = await getCustomShopRunCount();
    await AsyncStorage.setItem(CUSTOM_SHOP_KEY, String(count + 1));
  } catch {}
}

export async function customShopGate(isPro: boolean): Promise<{
  allowed: boolean;
  isFirstRun: boolean;
}> {
  if (isPro || BETA_FULL_ACCESS) return { allowed: true, isFirstRun: false };
  const count = await getCustomShopRunCount();
  return {
    allowed: count < FREE_CUSTOM_SHOP_RUNS_LIFETIME,
    isFirstRun: count === 0,
  };
}

// ─── Boards ───────────────────────────────────────────────────────────────────
export function boardCreationAllowed(isPro: boolean, currentBoardCount: number): boolean {
  if (isPro || BETA_FULL_ACCESS) return true;
  return currentBoardCount < FREE_BOARDS_LIMIT;
}

// ─── Last pick ────────────────────────────────────────────────────────────────
export async function saveLastPick(pick: LastPick): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_PICK_KEY, JSON.stringify(pick));
  } catch {}
}

export async function loadLastPick(): Promise<LastPick | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_PICK_KEY);
    return raw ? (JSON.parse(raw) as LastPick) : null;
  } catch { return null; }
}

// ─── Milestones ───────────────────────────────────────────────────────────────
export const MILESTONE_COUNTS = [5, 10, 25, 50, 100];

/**
 * Returns the milestone number if a new one was just crossed (and marks it shown).
 * Returns null if no new milestone.
 */
export async function checkMilestone(pedalCount: number): Promise<number | null> {
  try {
    const raw  = await AsyncStorage.getItem(MILESTONE_KEY);
    const shown: number[] = raw ? JSON.parse(raw) : [];
    for (const ms of MILESTONE_COUNTS) {
      if (pedalCount >= ms && !shown.includes(ms)) {
        shown.push(ms);
        await AsyncStorage.setItem(MILESTONE_KEY, JSON.stringify(shown));
        return ms;
      }
    }
    return null;
  } catch { return null; }
}

// ─── Purchases ────────────────────────────────────────────────────────────────

/**
 * Trigger the App Store purchase sheet for the selected plan.
 * Pass userId so we can immediately update is_premium in Supabase on success.
 * Returns true if the user is now Pro, false if cancelled, throws on other errors.
 */
export async function purchasePro(plan: 'monthly' | 'annual', userId?: string): Promise<boolean> {
  const offerings = await Purchases.getOfferings();
  const pkg = plan === 'annual' ? offerings.current?.annual : offerings.current?.monthly;
  if (!pkg) throw new Error('No offerings available. Check RevenueCat dashboard setup.');

  const { customerInfo } = await Purchases.purchasePackage(pkg);
  const isPro = !!customerInfo.entitlements.active[ENTITLEMENT_ID];

  if (userId) {
    await supabase.from('user_profiles').update({ is_premium: isPro }).eq('id', userId);
  }
  return isPro;
}

/**
 * Restore previous purchases (required by App Store guidelines).
 * Returns true if the user has an active Pro entitlement after restoring.
 */
export async function restorePurchases(userId?: string): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  const isPro = !!info.entitlements.active[ENTITLEMENT_ID];

  if (userId) {
    await supabase.from('user_profiles').update({ is_premium: isPro }).eq('id', userId);
  }
  return isPro;
}
