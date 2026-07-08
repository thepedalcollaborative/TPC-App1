/**
 * TPC Subscription layer
 *
 * Handles entitlement sync, milestone tracking, and board-creation gating.
 * Free-tier advisor and Custom Shop gates are enforced server-side via
 * Supabase Edge Functions.
 *
 * The `isPro` boolean comes from profile.is_premium (synced from Supabase).
 *
 * ── RevenueCat integration ────────────────────────────────────────────────
 * react-native-purchases is NOT included in this build. The SDK was causing
 * crashes on iOS 26 due to a TurboModule interop bug. The paywall UI is
 * preserved as a placeholder; purchase flows will be re-enabled once a
 * stable iOS 26–compatible version ships.
 *
 * is_premium is managed manually (Patreon, admin grants) until then.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── RevenueCat stubs ─────────────────────────────────────────────────────────

export function hasBetaFullAccess(): boolean { return false; }
export function isRevenueCatConfigured(): boolean { return false; }
export function configureRevenueCat(_userId?: string): void { /* no-op */ }
export async function syncEntitlement(): Promise<boolean> { return false; }

// ─── Pricing display ─────────────────────────────────────────────────────────
export const PRICE_MONTHLY         = '$3.99';
export const PRICE_ANNUAL          = '$29.99';
export const PRICE_ANNUAL_MONTHLY  = '$2.50';
export const PRICE_ANNUAL_SAVINGS  = '37%';

export type LivePrices = {
  monthlyPrice: string;
  annualPrice: string;
  annualMonthlyPrice: string;
  savingsPercent: string;
};

export async function fetchLivePrices(): Promise<LivePrices | null> { return null; }

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
  if (isPro) return true;
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

export async function purchasePro(_plan: 'monthly' | 'annual', _userId?: string): Promise<boolean> {
  throw new Error('In-app purchases are temporarily unavailable. Please check back soon.');
}

export async function restorePurchases(_userId?: string): Promise<boolean> {
  throw new Error('In-app purchases are temporarily unavailable. Please check back soon.');
}
