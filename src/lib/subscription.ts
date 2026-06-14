/**
 * TPC Subscription layer
 *
 * Handles RevenueCat purchases, entitlement sync, milestone tracking, and
 * board-creation gating. Free-tier advisor and Custom Shop gates are now
 * enforced server-side via Supabase Edge Functions.
 *
 * The `isPro` boolean comes from profile.is_premium (synced from Supabase).
 *
 * ── RevenueCat integration ────────────────────────────────────────────────
 *   1. npx expo install react-native-purchases
 *   2. Add to app.json plugins: ["react-native-purchases", { "apiKey": "appl_xxxx" }]
 *   3. Configure RevenueCat webhook → Supabase function → update user_profiles.is_premium
 *   4. On app launch, call Purchases.configure() + sync entitlement to profile
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import Constants from 'expo-constants';

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

// Track whether RevenueCat was actually configured this session.
// Guards syncEntitlement / restorePurchases from running against an
// unconfigured SDK and writing stale false values to the database.
let _rcConfigured = false;
export function isRevenueCatConfigured(): boolean { return _rcConfigured; }

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
    _rcConfigured = true;
  } catch (err) {
    if (__DEV__) console.warn('[TPC] RevenueCat configure error:', err);
  }
}

/**
 * Read the RevenueCat entitlement. Premium database writes must happen from
 * trusted server-side paths such as RevenueCat webhooks.
 * Returns true if the user is currently Pro.
 */
export async function syncEntitlement(): Promise<boolean> {
  // Only run when RevenueCat was actually configured this session.
  // Without an RC key, getCustomerInfo() returns empty entitlements and would
  // write is_premium: false to the DB — silently demoting manually-set Pro users.
  if (!_rcConfigured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    const isPro = !!info.entitlements.active[ENTITLEMENT_ID];
    return isPro;
  } catch { return false; }
}

// ─── Pricing display ─────────────────────────────────────────────────────────
// Fallback strings used in Expo Go (where RevenueCat can't run) and as
// placeholders before live prices load. Always prefer fetchLivePrices().
export const PRICE_MONTHLY         = '$3.99';
export const PRICE_ANNUAL          = '$29.99';
export const PRICE_ANNUAL_MONTHLY  = '$2.50';
export const PRICE_ANNUAL_SAVINGS  = '37%';

export type LivePrices = {
  monthlyPrice: string;      // e.g. "$5.99"
  annualPrice: string;       // e.g. "$49.99"
  annualMonthlyPrice: string; // annual ÷ 12, formatted
  savingsPercent: string;    // rounded % saved vs 12× monthly
};

/**
 * Fetch real localized prices from RevenueCat / StoreKit.
 * Returns null in Expo Go or if offerings aren't configured yet — callers
 * should fall back to the PRICE_* constants in that case.
 */
export async function fetchLivePrices(): Promise<LivePrices | null> {
  try {
    const offerings = await Purchases.getOfferings();
    const monthly = offerings.all['TPC Pro Monthly']?.availablePackages[0]
      ?? offerings.current?.monthly;
    const annual  = offerings.all['TPC Pro Annual']?.availablePackages[0]
      ?? offerings.current?.annual;
    if (!monthly || !annual) return null;

    const monthlyPrice = monthly.product.priceString;
    const annualPrice  = annual.product.priceString;

    // Per-month equivalent for the annual plan
    const annualPerMonth = annual.product.price / 12;
    // Use the same currency symbol as the annual priceString (e.g. "$")
    const currencySymbol = annualPrice.replace(/[\d.,\s]/g, '').trim() || '$';
    const annualMonthlyPrice = `${currencySymbol}${annualPerMonth.toFixed(2)}`;

    // % savings vs paying monthly for 12 months
    const fullMonthly = monthly.product.price * 12;
    const savings = fullMonthly > 0
      ? Math.round((1 - annual.product.price / fullMonthly) * 100)
      : 0;
    const savingsPercent = `${savings}%`;

    return { monthlyPrice, annualPrice, annualMonthlyPrice, savingsPercent };
  } catch {
    return null;
  }
}

// ─── AsyncStorage keys ────────────────────────────────────────────────────────
const MILESTONE_KEY       = 'tpc_milestones_shown';        // JSON: number[]
const VALUE_MILESTONE_KEY = 'tpc_value_milestones_shown';  // JSON: number[]

export type LastPick = {
  brand: string;
  model: string;
  why: string;
  timestamp: string;
};

// ─── Boards ───────────────────────────────────────────────────────────────────
export const FREE_BOARDS_LIMIT = 2;

export function boardCreationAllowed(isPro: boolean, currentBoardCount: number): boolean {
  if (isPro || BETA_FULL_ACCESS) return true;
  return currentBoardCount < FREE_BOARDS_LIMIT;
}

// ─── Milestones ───────────────────────────────────────────────────────────────
export const MILESTONE_COUNTS  = [5, 10, 25, 50, 100];
export const VALUE_MILESTONES  = [1000, 5000, 10000, 25000, 50000];

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

/**
 * Returns the dollar threshold if a new value milestone was just crossed (and marks it shown).
 * Returns null if no new milestone.
 */
export async function checkValueMilestone(totalValue: number): Promise<number | null> {
  try {
    const raw   = await AsyncStorage.getItem(VALUE_MILESTONE_KEY);
    const shown: number[] = raw ? JSON.parse(raw) : [];
    for (const ms of VALUE_MILESTONES) {
      if (totalValue >= ms && !shown.includes(ms)) {
        shown.push(ms);
        await AsyncStorage.setItem(VALUE_MILESTONE_KEY, JSON.stringify(shown));
        return ms;
      }
    }
    return null;
  } catch { return null; }
}

// ─── Purchases ────────────────────────────────────────────────────────────────

/**
 * Trigger the App Store purchase sheet for the selected plan.
 * Returns true if the user is now Pro, false if cancelled, throws on other errors.
 */
export async function purchasePro(plan: 'monthly' | 'annual', userId?: string): Promise<boolean> {
  void userId;
  const offerings = await Purchases.getOfferings();
  const pkg = plan === 'annual'
    ? (offerings.all['TPC Pro Annual']?.availablePackages[0] ?? offerings.current?.annual)
    : (offerings.all['TPC Pro Monthly']?.availablePackages[0] ?? offerings.current?.monthly);
  if (!pkg) throw new Error('No offerings available. Check RevenueCat dashboard setup.');

  const { customerInfo } = await Purchases.purchasePackage(pkg);
  const isPro = !!customerInfo.entitlements.active[ENTITLEMENT_ID];
  return isPro;
}

/**
 * Restore previous purchases (required by App Store guidelines).
 * Returns true if the user has an active Pro entitlement after restoring.
 */
export async function restorePurchases(userId?: string): Promise<boolean> {
  void userId;
  const info = await Purchases.restorePurchases();
  const isPro = !!info.entitlements.active[ENTITLEMENT_ID];
  return isPro;
}
