import { create } from 'zustand';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase, Pedal, UserPedal, Board, UserProfile, invokeEdgeFunction, SecureStorageAdapter } from '../lib/supabase';
import type { PaywallReason } from '../screens/PaywallScreen';
import { hasBetaFullAccess } from '../lib/subscription';
import type { LastPick } from '../lib/subscription';
import { CURRENCIES, type CurrencyCode } from '../lib/formatMoney';

let marketValuesRefreshInFlight = false;
let imageEnrichmentInFlight = false;
const AUTH_TRACE = false;
const IS_EXPO_GO =
  Constants.appOwnership === 'expo' ||
  (Constants as unknown as { executionEnvironment?: string }).executionEnvironment === 'storeClient';
let explicitSignOutInProgress = false;

type Store = {
  // Auth
  session: Session | null;
  setSession: (session: Session | null) => void;

  // Profile
  profile: UserProfile | null;
  fetchProfile: () => Promise<void>;

  // Paywall
  paywallVisible: boolean;
  paywallReason: PaywallReason;
  openPaywall: (reason: PaywallReason) => void;
  closePaywall: () => void;

  // Last Custom Shop pick (persisted to AsyncStorage)
  lastCustomShopPick: LastPick | null;
  setLastCustomShopPick: (pick: LastPick) => void;

  // Weekly AI pick (Pro only — one per ISO week, fetched from edge function)
  weeklyPick: {
    brand: string;
    model: string;
    why: string;
    category: string | null;
    weekKey: string;
    generatedAt: string;
    videoId: string | null;
    videoTitle: string | null;
    isTpcVideo: boolean;
  } | null;
  weeklyPickLoading: boolean;
  fetchWeeklyPick: () => Promise<void>;

  // Milestone to celebrate (set after fetchPedals detects a new milestone)
  milestoneToShow: number | null;
  clearMilestone: () => void;
  // Value milestone (dollars) to celebrate (set after market values update)
  valueMilestoneToShow: number | null;
  clearValueMilestone: () => void;

  // Pedals
  ownedPedals: UserPedal[];
  wishlistPedals: UserPedal[];
  retiredPedals: UserPedal[];
  listedPedals: UserPedal[]; // ownedPedals where listing_status IS NOT NULL
  totalInvested: number;
  marketValues: Record<string, number>;  // pedal_id → market_value
  marketSamples: Record<string, number>; // pedal_id → data points behind the value
  totalMarketValue: number;
  // Number of wishlist items where market price ≤ target/avg (drives Vault tab badge)
  wishlistDropCount: number;
  userImageUrls: Record<string, string>; // user_pedal_id -> signed full url
  userImageThumbUrls: Record<string, string>; // user_pedal_id -> signed thumb url
  viewMode: 'tile' | 'text';
  setViewMode: (mode: 'tile' | 'text') => void;

  // Preferences
  wifeMode: boolean;
  setWifeMode: (v: boolean) => void;
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  /** Live exchange rates keyed by currency code, base USD (e.g. { GBP: 0.79 }) */
  exchangeRates: Record<string, number>;
  fetchExchangeRates: () => Promise<void>;

  fetchPedals: () => Promise<void>;
  fetchMarketValues: () => Promise<void>;
  refreshUserImages: (list?: UserPedal[]) => Promise<void>;

  // Boards
  boards: Board[];
  fetchBoards: () => Promise<void>;

  // Image enrichment
  enrichMissingImages: () => Promise<void>;

  // Wishlist actions
  addToWishlist: (
    brand: string,
    model: string,
    catalogData?: { category: string; subcategory: string; description: string; analog: boolean; price: number | null }
  ) => Promise<'added' | 'exists' | 'not_found' | 'error'>;

  // FS/FT listing
  updateListingStatus: (
    userPedalId: string,
    listing: { listing_status: UserPedal['listing_status']; asking_price: number | null; trade_wants: string | null }
  ) => Promise<{ error: string | null }>;

  // Auth actions
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ success: boolean; error?: string }>;
};

type WeeklyPickResponse = {
  brand: string;
  model: string;
  why: string;
  category: string | null;
  weekKey: string;
  generatedAt: string;
  videoId: string | null;
  videoTitle: string | null;
  isTpcVideo: boolean;
};

type MarketValueResponse = {
  market_value?: number;
  sample_count?: number;
};

type SearchPedalsUpsertResponse = {
  pedal?: { id: string; avg_price?: number | null };
};

const PEDAL_CATEGORY_SET = new Set([
  'drive',
  'boost',
  'compressor',
  'eq',
  'delay',
  'reverb',
  'modulation',
  'looper',
  'pitch',
  'utility',
  'ambient',
  'synth',
  'other',
  'multifx',
  'modeler',
]);

function normalizePedalCategory(input?: string | null): string {
  const category = (input ?? '').toLowerCase().trim();
  if (PEDAL_CATEGORY_SET.has(category)) return category;
  if (category.includes('fuzz') || category.includes('drive') || category.includes('distort')) return 'drive';
  if (category.includes('compress')) return 'compressor';
  if (category.includes('eq')) return 'eq';
  if (category.includes('delay') || category.includes('echo')) return 'delay';
  if (category.includes('reverb')) return 'reverb';
  if (category.includes('chorus') || category.includes('phaser') || category.includes('flanger') || category.includes('modulat')) return 'modulation';
  if (category.includes('loop')) return 'looper';
  if (category.includes('pitch') || category.includes('octave')) return 'pitch';
  if (category.includes('ambient')) return 'ambient';
  if (category.includes('synth')) return 'synth';
  if (category.includes('multi')) return 'multifx';
  if (category.includes('model')) return 'modeler';
  return 'other';
}

export const useStore = create<Store>((set, get) => ({
  // ─── Auth ───────────────────────────────────────────────────────────────────
  session: null,

  setSession: (session) => {
    const prevUserId = get().session?.user?.id;
    const clearSignedOutState = () => {
      set({
        session: null,
        profile: null,
        ownedPedals: [],
        wishlistPedals: [],
        retiredPedals: [],
        totalInvested: 0,
        marketValues: {},
        marketSamples: {},
        totalMarketValue: 0,
        wishlistDropCount: 0,
        userImageUrls: {},
        userImageThumbUrls: {},
        boards: [],
        lastCustomShopPick: null,
        milestoneToShow: null,
        valueMilestoneToShow: null,
      });
      AsyncStorage.removeItem('tpc_user_image_cache').catch(() => {});
    };

    // Guard against transient null-session churn (Expo Go / token refresh races).
    // If SDK still has a user session, ignore this null transition.
    if (!session && prevUserId) {
      // In Expo Go specifically, ignore automatic null-session churn unless this
      // was an explicit user sign-out action from inside the app.
      if (IS_EXPO_GO && !explicitSignOutInProgress) {
        if (__DEV__) {
          console.warn('[AuthGuard] Ignoring setSession(null) in Expo Go (not explicit sign-out)', {
            prevUserId,
          });
        }
        return;
      }

      supabase.auth.getSession()
        .then(({ data: { session: latestSession } }) => {
          if (latestSession?.user?.id === prevUserId) {
            if (__DEV__) {
              console.warn('[AuthGuard] Ignoring setSession(null); session still present', {
                prevUserId,
              });
            }
            return;
          }
          clearSignedOutState();
        })
        .catch(() => {
          clearSignedOutState();
        });
      return;
    }

    if (__DEV__ && AUTH_TRACE) {
      const nextUserId = session?.user?.id ?? null;
      console.warn('[AuthTrace] setSession', {
        prevUserId,
        nextUserId,
        changed: prevUserId !== nextUserId,
      });
      if (!session) {
        const trace = new Error('[AuthTrace] setSession(null)').stack
          ?.split('\n')
          .slice(0, 6)
          .join('\n');
        if (trace) console.warn(trace);
      }
    }
    set({ session });
    if (session) {
      // Only kick off data fetches when the user actually changes (new sign-in).
      // Token refreshes and other auth events reuse the same user — skip redundant fetches
      // that can race each other and temporarily blank the collection.
      if (prevUserId !== session.user.id) {
        // Fire all three in parallel — they're independent queries
        void Promise.all([
          get().fetchProfile(),
          get().fetchPedals(),
          get().fetchBoards(),
        ]);
      }
    } else {
      clearSignedOutState();
    }
  },

  // ─── Paywall ────────────────────────────────────────────────────────────────
  paywallVisible: false,
  paywallReason: 'general',
  openPaywall: (reason) => set({ paywallVisible: true, paywallReason: reason }),
  closePaywall: () => set({ paywallVisible: false }),

  // ─── Last Custom Shop Pick ───────────────────────────────────────────────────
  weeklyPick: null,
  weeklyPickLoading: false,

  fetchWeeklyPick: async () => {
    const { session, profile, weeklyPick } = get();
    if (!session?.user || (!profile?.is_premium && !hasBetaFullAccess())) return;

    // Don't re-fetch if we already have this week's pick
    const weekKey = (() => {
      const d = new Date();
      const day = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - day);
      const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const w = Math.ceil(((d.getTime() - ys.getTime()) / 86400000 + 1) / 7);
      return `${d.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
    })();
    if (weeklyPick?.weekKey === weekKey) return;

    set({ weeklyPickLoading: true });
    try {
      // 45-second timeout guards against the weekly-pick edge function hanging
      // on a slow Claude cold start — without it, weeklyPickLoading stays true
      // forever if the mobile network drops mid-request.
      const timeoutMs = 45_000;
      const result = await Promise.race([
        invokeEdgeFunction<WeeklyPickResponse>('weekly-pick', {}),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('weekly-pick timeout')), timeoutMs)
        ),
      ]);
      const { data, error } = result;
      if (error || !data?.brand) {
        if (__DEV__) {
          const ctx = (error as { context?: { status?: number; text?: () => Promise<string> } } | null)?.context;
          let body = '';
          if (ctx?.text) {
            try { body = await ctx.text(); } catch {}
          }
          console.warn('[Store] fetchWeeklyPick error:', {
            message: String((error as { message?: string } | null)?.message ?? error),
            status: ctx?.status,
            body,
          });
        }
        return;
      }
      set({ weeklyPick: data });
    } catch (e) {
      if (__DEV__) console.warn('[Store] fetchWeeklyPick exception:', String(e));
    } finally {
      set({ weeklyPickLoading: false });
    }
  },

  lastCustomShopPick: null,
  setLastCustomShopPick: (pick) => {
    set({ lastCustomShopPick: pick });
    SecureStorageAdapter.setItem('tpc_last_custom_shop_pick', JSON.stringify(pick)).catch(() => {});
  },

  // ─── Milestone ───────────────────────────────────────────────────────────────
  milestoneToShow: null,
  clearMilestone: () => set({ milestoneToShow: null }),
  valueMilestoneToShow: null,
  clearValueMilestone: () => set({ valueMilestoneToShow: null }),

  // ─── Profile ────────────────────────────────────────────────────────────────
  profile: null,

  fetchProfile: async () => {
    const { session } = get();
    if (!session?.user) return;
    const userId = session.user.id;
    const profileCacheKey = `tpc_profile_cache_${userId}`;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      if (__DEV__) console.warn('[Store] fetchProfile error:', error.message);
      try {
        const cached = await SecureStorageAdapter.getItem(profileCacheKey);
        if (cached) {
          set({ profile: JSON.parse(cached) as UserProfile });
          return;
        }
      } catch {}
      return;
    }
    if (get().session?.user?.id !== userId) return;

    if (data) {
      set({ profile: data as UserProfile });
      SecureStorageAdapter.setItem(profileCacheKey, JSON.stringify(data)).catch(() => {});
    } else {
      // Attempt to self-heal a missing profile row. If RLS rejects this insert,
      // we still continue with a local fallback profile.
      await supabase
        .from('user_profiles')
        .upsert(
          {
            id: userId,
            display_name:
              (session.user.user_metadata?.full_name as string | undefined)
              ?? (session.user.user_metadata?.name as string | undefined)
              ?? session.user.email?.split('@')[0]
              ?? null,
          },
          { onConflict: 'id' }
        );

      const { data: created } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (created && get().session?.user?.id === userId) {
        set({ profile: created as UserProfile });
        SecureStorageAdapter.setItem(profileCacheKey, JSON.stringify(created)).catch(() => {});
        return;
      }

      // Profile row still missing after upsert attempt.
      // Always prefer cache over a bare fallback — the cache carries the real
      // is_premium value and avoids a transient free-tier demotion.
      try {
        const cached = await SecureStorageAdapter.getItem(profileCacheKey);
        if (cached) {
          set({ profile: JSON.parse(cached) as UserProfile });
          return;
        }
      } catch {}
      // Absolute last resort — no DB row, no cache. Never set is_premium: false
      // for users who may be Pro; use the beta flag as a floor, but leave
      // is_premium undefined so server-side gates (not client state) decide access.
      set({
        profile: {
          id: userId,
          username: null,
          display_name:
            (session.user.user_metadata?.full_name as string | undefined)
            ?? (session.user.user_metadata?.name as string | undefined)
            ?? session.user.email?.split('@')[0]
            ?? null,
          is_admin: false,
          is_premium: hasBetaFullAccess(),
          pedal_finder_uses_today: 0,
          // Prevent forced onboarding loop when backend profile row is temporarily missing.
          pedal_expert_profile: { onboarding_skipped_at: new Date().toISOString() } as UserProfile['pedal_expert_profile'],
          created_at: new Date().toISOString(),
        } as UserProfile,
      });
    }
  },

  // ─── Pedals ─────────────────────────────────────────────────────────────────
  ownedPedals: [],
  wishlistPedals: [],
  retiredPedals: [],
  listedPedals: [],
  totalInvested: 0,
  marketValues: {},
  marketSamples: {},
  totalMarketValue: 0,
  wishlistDropCount: 0,
  userImageUrls: {},
  userImageThumbUrls: {},
  viewMode: 'tile',
  setViewMode: (mode) => {
    set({ viewMode: mode });
    AsyncStorage.setItem('tpc_view_mode', mode).catch(() => {});
  },

  wifeMode: false,
  setWifeMode: (v) => {
    set({ wifeMode: v });
    AsyncStorage.setItem('tpc_wife_mode', v ? '1' : '0').catch(() => {});
  },
  currency: 'USD',
  setCurrency: (c) => {
    set({ currency: c });
    AsyncStorage.setItem('tpc_currency', c).catch(() => {});
    // Fetch fresh rates whenever currency changes (no-op if already cached today)
    get().fetchExchangeRates();
  },

  exchangeRates: {},
  fetchExchangeRates: async () => {
    const CACHE_KEY = 'tpc_exchange_rates';
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    try {
      // Check cache first
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        const { rates, timestamp } = JSON.parse(cached) as {
          rates: Record<string, number>;
          timestamp: number;
        };
        if (Date.now() - timestamp < CACHE_TTL) {
          set({ exchangeRates: rates });
          return;
        }
      }

      // Fetch fresh rates from Frankfurter (free, no key, ECB daily rates)
      const response = await fetch(
        'https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,CAD,AUD,JPY',
      );
      if (!response.ok) return;
      const json = await response.json() as { rates: Record<string, number> };
      const rates = json.rates ?? {};

      set({ exchangeRates: rates });
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ rates, timestamp: Date.now() })).catch(() => {});
    } catch {
      // Silently fail — USD fallback (rate = 1) is always safe
    }
  },

  fetchPedals: async () => {
    const { session } = get();
    if (!session?.user) return;

    const { data, error } = await supabase
      .from('user_pedals')
      .select('*, pedal:pedals(*), colorway:pedal_colorways(*)')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      if (__DEV__) console.warn('[Store] fetchPedals error:', error.message);
      return;
    }
    if (data) {
      const owned = data.filter(p => p.status === 'owned') as UserPedal[];
      const totalInvested = owned.reduce((sum, p) => sum + (p.purchase_price ?? 0), 0);
      set({
        ownedPedals: owned,
        wishlistPedals: data.filter(p => p.status === 'wishlist') as UserPedal[],
        retiredPedals: data.filter(p => p.status === 'retired') as UserPedal[],
        listedPedals: owned.filter(p => p.listing_status != null),
        totalInvested,
      });
      get().refreshUserImages(data as UserPedal[]);
      // Non-blocking: refresh market values and missing images in background
      get().fetchMarketValues();
      setTimeout(() => get().enrichMissingImages(), 800);

      // Check for collection milestone (non-blocking)
      import('../lib/subscription').then(({ checkMilestone }) => {
        checkMilestone(owned.length).then(ms => {
          if (ms !== null) set({ milestoneToShow: ms });
        });
      }).catch(() => {});
    }
  },

  fetchMarketValues: async () => {
    if (marketValuesRefreshInFlight) return;
    marketValuesRefreshInFlight = true;
    try {
    const { session, ownedPedals, wishlistPedals } = get();
    if (!session?.user || (ownedPedals.length === 0 && wishlistPedals.length === 0)) return;

    const allTracked = [...ownedPedals, ...wishlistPedals];
    const pedalIds = [...new Set(allTracked.map(p => p.pedal_id))];

    // 1. Load whatever is already cached in the DB
    const { data: cached } = await supabase
      .from('pedal_market_data')
      .select('pedal_id, condition, market_value, sample_count, updated_at')
      .in('pedal_id', pedalIds);

    // Rows are keyed by (pedal_id, condition) — index both so each pedal
    // resolves to the row matching its own condition, not an arbitrary one.
    const cachedMap = new Map((cached ?? []).map(c => [`${c.pedal_id}|${c.condition}`, c]));
    const cachedAnyMap = new Map((cached ?? []).map(c => [c.pedal_id, c]));
    const valueMap: Record<string, number> = {};
    const sampleMap: Record<string, number> = {};
    const staleIds: string[] = [];

    for (const up of allTracked) {
      const hit = cachedMap.get(`${up.pedal_id}|${up.condition ?? 'used'}`)
        ?? cachedAnyMap.get(up.pedal_id);
      if (hit?.market_value) {
        valueMap[up.pedal_id] = hit.market_value;
        if (hit.sample_count != null) sampleMap[up.pedal_id] = hit.sample_count;
        const ageHours = (Date.now() - new Date(hit.updated_at).getTime()) / 3_600_000;
        if (ageHours > 24) staleIds.push(up.pedal_id);
      } else {
        staleIds.push(up.pedal_id);
      }
    }

    // Helper: count wishlist items where market ≤ target/avg
    const calcWishlistDrops = (vals: Record<string, number>) => {
      return get().wishlistPedals.filter(up => {
        const mkt = vals[up.pedal_id];
        const target = up.target_price ?? up.pedal?.avg_price ?? null;
        return mkt != null && target != null && mkt <= target;
      }).length;
    };
    const calcOwnedTotal = (vals: Record<string, number>) =>
      get().ownedPedals.reduce((sum, up) => sum + (vals[up.pedal_id] ?? 0), 0);

    // Update UI immediately with cached values
    const initialTotal = calcOwnedTotal(valueMap);
    set({
      marketValues: { ...valueMap },
      marketSamples: { ...sampleMap },
      totalMarketValue: initialTotal,
      wishlistDropCount: calcWishlistDrops(valueMap),
    });

    // 2. Refresh stale/missing via edge function
    for (const up of allTracked.filter(p => staleIds.includes(p.pedal_id))) {
      if (!up.pedal) continue;
      try {
        const { data } = await invokeEdgeFunction<MarketValueResponse>('market-value', {
          pedal_id: up.pedal_id,
          brand: up.pedal.brand,
          model: up.pedal.model,
          condition: up.condition ?? undefined,
        });
        if (data?.market_value) {
          const { marketValues: current, marketSamples: currentSamples } = get();
          const updated = { ...current, [up.pedal_id]: data.market_value };
          const newTotal = calcOwnedTotal(updated);
          set({
            marketValues: updated,
            marketSamples: data.sample_count != null
              ? { ...currentSamples, [up.pedal_id]: data.sample_count }
              : currentSamples,
            totalMarketValue: newTotal,
            wishlistDropCount: calcWishlistDrops(updated),
          });
          // Check for vault value milestones (non-blocking)
          import('../lib/subscription').then(({ checkValueMilestone }) => {
            checkValueMilestone(newTotal).then(ms => {
              if (ms !== null) set({ valueMilestoneToShow: ms });
            });
          }).catch(() => {});
        }
      } catch {
        // Market data is non-critical — fail silently
      }
    }
    } finally {
      marketValuesRefreshInFlight = false;
    }
  },

  refreshUserImages: async (list) => {
    const items = list ?? [...get().ownedPedals, ...get().wishlistPedals, ...get().retiredPedals];
    const toFetch = items.filter(p => p.user_image_path);
    if (toFetch.length === 0) {
      set({ userImageUrls: {}, userImageThumbUrls: {} });
      return;
    }
    const bucket = 'user-pedal-photos';
    const cacheKey = 'tpc_user_image_cache';
    let cache: Record<string, { url: string; expiresAt: number }> = {};
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) cache = JSON.parse(raw);
    } catch {
      cache = {};
    }

    const now = Date.now();
    const freshWindowMs = 5 * 60 * 1000;
    const results: Array<readonly [string, string]> = [];
    const thumbResults: Array<readonly [string, string]> = [];
    const needsFetch: Array<{ id: string; path: string }> = [];

    for (const p of toFetch) {
      const path = p.user_image_path as string;
      const thumbPath = path.replace(/\.[^/.]+$/, '_sm.jpg');
      const cached = cache[path];
      const cachedThumb = cache[thumbPath];
      if (cached && cached.url && cached.expiresAt - now > freshWindowMs) {
        results.push([p.id, cached.url] as const);
      } else {
        needsFetch.push({ id: p.id, path });
      }
      if (cachedThumb && cachedThumb.url && cachedThumb.expiresAt - now > freshWindowMs) {
        thumbResults.push([p.id, cachedThumb.url] as const);
      }
    }

    if (needsFetch.length > 0) {
      // Build a flat list of all paths (full + thumb) and fetch in ONE bulk call
      // instead of 2 * N individual createSignedUrl requests.
      const EXPIRES = 60 * 60 * 24 * 7; // 7 days
      const allPaths = needsFetch.flatMap(({ path }) => [
        path,
        path.replace(/\.[^/.]+$/, '_sm.jpg'),
      ]);
      const { data: bulkData } = await supabase.storage
        .from(bucket)
        .createSignedUrls(allPaths, EXPIRES);

      const urlByPath: Record<string, string> = {};
      for (const entry of bulkData ?? []) {
        if (entry.signedUrl && entry.path) urlByPath[entry.path] = entry.signedUrl;
      }

      for (const { id, path } of needsFetch) {
        const thumbPath = path.replace(/\.[^/.]+$/, '_sm.jpg');
        const url = urlByPath[path] ?? '';
        const thumbUrl = urlByPath[thumbPath] ?? '';
        if (url) cache[path] = { url, expiresAt: now + 7 * 24 * 60 * 60 * 1000 };
        if (thumbUrl) cache[thumbPath] = { url: thumbUrl, expiresAt: now + 7 * 24 * 60 * 60 * 1000 };
        if (thumbUrl) {
          thumbResults.push([id, thumbUrl] as const);
        } else if (url) {
          thumbResults.push([id, url] as const);
        }
        if (url) results.push([id, url] as const);
      }
      AsyncStorage.setItem(cacheKey, JSON.stringify(cache)).catch(() => {});
    }

    const map: Record<string, string> = {};
    for (const [id, url] of results) {
      if (url) map[id] = url;
    }
    const thumbMap: Record<string, string> = {};
    for (const [id, url] of thumbResults) {
      if (url) thumbMap[id] = url;
    }
    set({ userImageUrls: map, userImageThumbUrls: thumbMap });
  },

  // ─── Boards ─────────────────────────────────────────────────────────────────
  boards: [],

  fetchBoards: async () => {
    const { session } = get();
    if (!session?.user) return;

    const { data, error } = await supabase
      .from('boards')
      .select('*, slots:board_slots(*, pedal:pedals(*))')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      if (__DEV__) console.warn('[Store] fetchBoards error:', error.message);
      return;
    }
    if (data) set({ boards: data as Board[] });
  },

  // ─── Image Enrichment ────────────────────────────────────────────────────────

  enrichMissingImages: async () => {
    if (imageEnrichmentInFlight) return;
    imageEnrichmentInFlight = true;
    try {
    const { session, ownedPedals, wishlistPedals, retiredPedals } = get();
    if (!session?.user) return;

    // Collect pedals that need enrichment:
    //   Priority 1 — no image at all
    //   Priority 2 — image exists but came from a raw reverb_listing (low quality)
    // Limit to 6 per run to stay within Reverb rate limits.
    const seen = new Set<string>();
    const needsImage:   { id: string; brand: string; model: string }[] = [];
    const needsUpgrade: { id: string; brand: string; model: string }[] = [];

    for (const up of [...ownedPedals, ...wishlistPedals, ...retiredPedals]) {
      const p = up.pedal;
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      if (!p.image_url) {
        needsImage.push({ id: p.id, brand: p.brand, model: p.model });
      } else if (p.image_source === 'reverb_listing' || p.image_source == null) {
        needsUpgrade.push({ id: p.id, brand: p.brand, model: p.model });
      }
    }

    // Process: no-image pedals first, then low-quality upgrades
    const queue = [...needsImage, ...needsUpgrade].slice(0, 6);

    for (const p of queue) {
      try {
        const { data } = await invokeEdgeFunction('pedal-image', {
          pedal_id: p.id,
          brand:    p.brand,
          model:    p.model,
        });

        const imageUrl: string | null = (data as { image_url?: string | null })?.image_url ?? null;
        const imageSource = (data as { image_source?: string | null })?.image_source ?? null;
        if (!imageUrl) continue;

        // Patch all three lists in local state
        const patch = (list: UserPedal[]) =>
          list.map(up =>
            up.pedal?.id === p.id
              ? { ...up, pedal: { ...up.pedal!, image_url: imageUrl, image_source: imageSource as Pedal['image_source'] } }
              : up
          );
        set(s => ({
          ownedPedals:    patch(s.ownedPedals),
          wishlistPedals: patch(s.wishlistPedals),
          retiredPedals:  patch(s.retiredPedals),
        }));
      } catch {
        // Non-critical — skip silently
      }
    }
    } finally {
      imageEnrichmentInFlight = false;
    }
  },

  // ─── Wishlist ────────────────────────────────────────────────────────────────

  addToWishlist: async (brand, model, catalogData?) => {
    const { session } = get();
    if (!session?.user) return 'error';

    let pedalId: string | null = null;
    let resolvedTargetPrice: number | null = catalogData?.price ?? null;

    const findExistingPedalId = async (): Promise<string | null> => {
      const { data: pedals } = await supabase
        .from('pedals')
        .select('id')
        .ilike('brand', brand.trim())
        .ilike('model', model.trim())
        .limit(1);
      if (pedals?.[0]?.id) return pedals[0].id;

      // Fuzzy fallback: handle model variants like "Afterneath V3" vs "Afterneath"
      const simplifiedModel = model
        .toLowerCase()
        .replace(/\b(v|mk)\s*\d+\b/g, '')
        .replace(/\b(mkii|mkiii|iv|iii|ii)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!simplifiedModel) return null;

      const { data: fuzzy } = await supabase
        .from('pedals')
        .select('id')
        .ilike('brand', `%${brand.trim()}%`)
        .ilike('model', `%${simplifiedModel}%`)
        .limit(1);
      if (fuzzy?.[0]?.id) return fuzzy[0].id;

      // Token fallback: catch catalog model aliases like
      // "Boss MD-500" vs "Boss MD-500 Modulation Processor".
      const modelTokens = (model.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
        .filter((t) => t.length >= 3)
        .filter((t) => !['pedal', 'effects', 'effect', 'processor', 'modulation', 'delay', 'reverb'].includes(t));

      const strongestToken =
        modelTokens.find((t) => /\d/.test(t)) ??
        modelTokens[0] ??
        null;

      if (strongestToken) {
        const { data: tokenMatch } = await supabase
          .from('pedals')
          .select('id')
          .ilike('brand', `%${brand.trim()}%`)
          .ilike('model', `%${strongestToken}%`)
          .limit(1);
        if (tokenMatch?.[0]?.id) return tokenMatch[0].id;
      }

      return null;
    };

    const logEdgeError = async (label: string, err: unknown) => {
      if (!__DEV__) return;
      try {
        const anyErr = err as {
          message?: string;
          context?: { status?: number; text?: () => Promise<string> };
        } | null;
        const status = anyErr?.context?.status;
        let body = '';
        if (anyErr?.context?.text) {
          try { body = await anyErr.context.text(); } catch {}
        }
        console.warn(label, {
          message: String(anyErr?.message ?? err),
          status,
          body,
        });
      } catch {
        console.warn(label, err);
      }
    };

    // Auto-upsert via edge function (also enriches image_url)
    if (catalogData) {
      const normalizedCategory = normalizePedalCategory(catalogData.category);
      const { data, error } = await invokeEdgeFunction<SearchPedalsUpsertResponse>('search-pedals', {
        action: 'upsert',
        brand,
        model,
        category: normalizedCategory,
        subcategory: catalogData.subcategory || 'Recommended',
        description: catalogData.description || null,
        analog: catalogData.analog,
        avg_price: catalogData.price,
        in_production: true,
      });
      if (!error && data?.pedal?.id) {
        pedalId = data.pedal.id as string;
        if (resolvedTargetPrice == null && typeof data.pedal.avg_price === 'number') {
          resolvedTargetPrice = data.pedal.avg_price;
        }
      } else {
        await logEdgeError('[Store] addToWishlist upsert error (catalogData):', error);
        // Fallback 1: existing row lookup
        pedalId = await findExistingPedalId();
        // Fallback 2: service-role upsert with minimal metadata
        if (!pedalId) {
          const { data: retryData, error: retryErr } = await invokeEdgeFunction<SearchPedalsUpsertResponse>('search-pedals', {
            action: 'upsert',
            brand,
            model,
            category: normalizedCategory,
            subcategory: catalogData.subcategory || 'Recommended',
            description: catalogData.description || null,
            analog: catalogData.analog ?? false,
            avg_price: catalogData.price ?? null,
            in_production: true,
          });
          if (!retryErr && retryData?.pedal?.id) {
            pedalId = retryData.pedal.id as string;
            if (resolvedTargetPrice == null && typeof retryData.pedal.avg_price === 'number') {
              resolvedTargetPrice = retryData.pedal.avg_price;
            }
          } else {
            await logEdgeError('[Store] addToWishlist retry upsert error:', retryErr);
            pedalId = await findExistingPedalId();
          }
        }
      }
    } else {
      // Find the pedal in the DB by brand + model
      pedalId = await findExistingPedalId();
      if (!pedalId) {
        // Weekly picks and advisor suggestions can reference pedals not yet in our catalog.
        // Create a minimal catalog row on-demand so wishlist add always works.
        const { data, error } = await invokeEdgeFunction<SearchPedalsUpsertResponse>('search-pedals', {
          action: 'upsert',
          brand,
          model,
          category: 'other',
          subcategory: 'Recommended',
          description: null,
          analog: false,
          avg_price: null,
          in_production: true,
        });
        if (error || !data?.pedal?.id) {
          await logEdgeError('[Store] addToWishlist upsert error (no catalogData):', error);
          // One more try with fuzzy lookup before giving up
          pedalId = await findExistingPedalId();
          if (!pedalId) return 'not_found';
        } else {
          pedalId = data.pedal.id as string;
          if (resolvedTargetPrice == null && typeof data.pedal.avg_price === 'number') {
            resolvedTargetPrice = data.pedal.avg_price;
          }
        }
      }
    }
    if (!pedalId) return 'error';

    // If the caller didn't provide a target price, try to use catalog avg_price.
    // This keeps weekly-pick -> wishlist resilient if DB constraints require a price.
    if (resolvedTargetPrice == null) {
      const { data: pedalRow } = await supabase
        .from('pedals')
        .select('avg_price')
        .eq('id', pedalId)
        .maybeSingle();
      if (typeof pedalRow?.avg_price === 'number') {
        resolvedTargetPrice = pedalRow.avg_price;
      }
    }

    // Check if already on wishlist (or owned/retired)
    const { data: existing, error: existingError } = await supabase
      .from('user_pedals')
      .select('id, status')
      .eq('user_id', session.user.id)
      .eq('pedal_id', pedalId)
      .limit(1);

    if (existingError) {
      if (__DEV__) console.warn('[Store] addToWishlist duplicate check error:', existingError.message);
      return 'error';
    }
    if (existing?.length) return 'exists';

    // Insert as wishlist — include target price from catalog if available
    let { error } = await supabase
      .from('user_pedals')
      .insert({
        user_id: session.user.id,
        pedal_id: pedalId,
        status: 'wishlist',
        target_price: resolvedTargetPrice,
      });

    // If a DB check requires target_price for wishlist and we still don't have one,
    // retry with a minimal fallback instead of failing the weekly-pick CTA.
    if (error && (error.message.toLowerCase().includes('target_price') || error.message.toLowerCase().includes('check'))) {
      const fallbackTarget = Math.max(1, Math.round((resolvedTargetPrice ?? 1) * 100) / 100);
      const retry = await supabase
        .from('user_pedals')
        .insert({
          user_id: session.user.id,
          pedal_id: pedalId,
          status: 'wishlist',
          target_price: fallbackTarget,
        });
      error = retry.error ?? null;
    }

    // If insert lost a race with another add, treat as exists instead of error.
    if (error) {
      if (__DEV__) console.warn('[Store] addToWishlist insert error:', error.message);
      const { data: raceExisting } = await supabase
        .from('user_pedals')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('pedal_id', pedalId)
        .limit(1);
      if (raceExisting?.length) return 'exists';
      return 'error';
    }

    // Refresh store
    await get().fetchPedals();
    return 'added';
  },

  // ─── FS/FT Listing ──────────────────────────────────────────────────────────
  updateListingStatus: async (userPedalId, listing) => {
    const { error } = await supabase
      .from('user_pedals')
      .update(listing)
      .eq('id', userPedalId);
    if (error) return { error: error.message };
    // Optimistic update
    useStore.setState(s => {
      const patch = (arr: UserPedal[]) =>
        arr.map(p => p.id === userPedalId ? { ...p, ...listing } : p);
      const nextOwned = patch(s.ownedPedals);
      return {
        ownedPedals: nextOwned,
        listedPedals: nextOwned.filter(p => p.listing_status != null),
      };
    });
    return { error: null };
  },

  // ─── Delete Account ─────────────────────────────────────────────────────────
  deleteAccount: async () => {
    const { data, error } = await invokeEdgeFunction<{ success: boolean }>('delete-account', {});
    if (error || !data?.success) {
      return { success: false, error: 'Could not delete account. Please try again.' };
    }
    // Clear local state — auth listener will fire SIGNED_OUT but we pre-clear
    explicitSignOutInProgress = true;
    try { await supabase.auth.signOut(); } catch { /* already deleted server-side */ }
    finally { explicitSignOutInProgress = false; }
    set({
      session: null, profile: null,
      ownedPedals: [], wishlistPedals: [], retiredPedals: [], listedPedals: [],
      totalInvested: 0, marketValues: {}, marketSamples: {}, totalMarketValue: 0,
      userImageUrls: {}, userImageThumbUrls: {},
      boards: [], weeklyPick: null, weeklyPickLoading: false,
    });
    return { success: true };
  },

  // ─── Sign Out ───────────────────────────────────────────────────────────────
  signOut: async () => {
    explicitSignOutInProgress = true;
    try {
      await supabase.auth.signOut();
    } finally {
      explicitSignOutInProgress = false;
    }
    set({
      session: null,
      profile: null,
      ownedPedals: [],
      wishlistPedals: [],
      retiredPedals: [],
      totalInvested: 0,
      marketValues: {},
      totalMarketValue: 0,
      userImageUrls: {},
      userImageThumbUrls: {},
      boards: [],
      weeklyPick: null,
      weeklyPickLoading: false,
    });
  },
}));

// Hydrate UI preferences + persisted state
AsyncStorage.multiGet(['tpc_view_mode', 'tpc_wife_mode', 'tpc_currency'])
  .then((pairs) => {
    const updates: {
      viewMode?: 'tile' | 'text';
      wifeMode?: boolean;
      currency?: CurrencyCode;
    } = {};
    const [viewModeRaw, wifeModeRaw, currencyRaw] = pairs.map(p => p[1]);
    if (viewModeRaw === 'tile' || viewModeRaw === 'text') updates.viewMode = viewModeRaw;
    if (wifeModeRaw === '1') updates.wifeMode = true;
    if (currencyRaw && CURRENCIES.some(c => c.code === currencyRaw))
      updates.currency = currencyRaw as CurrencyCode;
    if (Object.keys(updates).length) useStore.setState(updates);
  })
  .catch(() => {});

SecureStorageAdapter.getItem('tpc_last_custom_shop_pick')
  .then((raw) => {
    if (raw) useStore.setState({ lastCustomShopPick: JSON.parse(raw) });
  })
  .catch(() => {});

// Pre-fetch exchange rates on startup (cached for 24h, no-op if USD)
useStore.getState().fetchExchangeRates();
