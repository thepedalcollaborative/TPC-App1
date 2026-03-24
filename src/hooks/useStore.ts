import { create } from 'zustand';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, UserPedal, Board, UserProfile, invokeEdgeFunction } from '../lib/supabase';
import type { PaywallReason } from '../screens/PaywallScreen';
import { hasBetaFullAccess } from '../lib/subscription';
import type { LastPick } from '../lib/subscription';

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
  } | null;
  weeklyPickLoading: boolean;
  fetchWeeklyPick: () => Promise<void>;

  // Milestone to celebrate (set after fetchPedals detects a new milestone)
  milestoneToShow: number | null;
  clearMilestone: () => void;

  // Pedals
  ownedPedals: UserPedal[];
  wishlistPedals: UserPedal[];
  retiredPedals: UserPedal[];
  totalInvested: number;
  marketValues: Record<string, number>;  // pedal_id → market_value
  totalMarketValue: number;
  // Number of wishlist items where market price ≤ target/avg (drives Vault tab badge)
  wishlistDropCount: number;
  userImageUrls: Record<string, string>; // user_pedal_id -> signed full url
  userImageThumbUrls: Record<string, string>; // user_pedal_id -> signed thumb url
  viewMode: 'tile' | 'text';
  setViewMode: (mode: 'tile' | 'text') => void;
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

  // Auth actions
  signOut: () => Promise<void>;
};

export const useStore = create<Store>((set, get) => ({
  // ─── Auth ───────────────────────────────────────────────────────────────────
  session: null,

  setSession: (session) => {
    const prevUserId = get().session?.user?.id;
    set({ session });
    if (session) {
      // Only kick off data fetches when the user actually changes (new sign-in).
      // Token refreshes and other auth events reuse the same user — skip redundant fetches
      // that can race each other and temporarily blank the collection.
      if (prevUserId !== session.user.id) {
        get().fetchProfile();
        get().fetchPedals();
        get().fetchBoards();
      }
    } else {
      // Clear all user data on sign out
      set({
        profile: null,
        ownedPedals: [],
        wishlistPedals: [],
        retiredPedals: [],
        totalInvested: 0,
        marketValues: {},
        totalMarketValue: 0,
        wishlistDropCount: 0,
        userImageUrls: {},
        userImageThumbUrls: {},
        boards: [],
        lastCustomShopPick: null,
        milestoneToShow: null,
      });
      AsyncStorage.removeItem('tpc_user_image_cache').catch(() => {});
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
      const { data, error } = await invokeEdgeFunction('weekly-pick', {});
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
    AsyncStorage.setItem('tpc_last_custom_shop_pick', JSON.stringify(pick)).catch(() => {});
  },

  // ─── Milestone ───────────────────────────────────────────────────────────────
  milestoneToShow: null,
  clearMilestone: () => set({ milestoneToShow: null }),

  // ─── Profile ────────────────────────────────────────────────────────────────
  profile: null,

  fetchProfile: async () => {
    const { session } = get();
    if (!session?.user) return;
    const profileCacheKey = `tpc_profile_cache_${session.user.id}`;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();

    if (error) {
      if (__DEV__) console.warn('[Store] fetchProfile error:', error.message);
      try {
        const cached = await AsyncStorage.getItem(profileCacheKey);
        if (cached) {
          set({ profile: JSON.parse(cached) as UserProfile });
          return;
        }
      } catch {}
      return;
    }
    if (data) {
      set({ profile: data as UserProfile });
      AsyncStorage.setItem(profileCacheKey, JSON.stringify(data)).catch(() => {});
    } else {
      // Keep app stable even if user_profiles row is temporarily missing.
      // DB should still be backfilled, but this prevents UI/gating crashes.
      set({
        profile: {
          id: session.user.id,
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
      try {
        const cached = await AsyncStorage.getItem(profileCacheKey);
        if (cached) {
          set({ profile: JSON.parse(cached) as UserProfile });
        }
      } catch {}
    }
  },

  // ─── Pedals ─────────────────────────────────────────────────────────────────
  ownedPedals: [],
  wishlistPedals: [],
  retiredPedals: [],
  totalInvested: 0,
  marketValues: {},
  totalMarketValue: 0,
  wishlistDropCount: 0,
  userImageUrls: {},
  userImageThumbUrls: {},
  viewMode: 'tile',
  setViewMode: (mode) => {
    set({ viewMode: mode });
    AsyncStorage.setItem('tpc_view_mode', mode).catch(() => {});
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
    const { session, ownedPedals, wishlistPedals } = get();
    if (!session?.user || (ownedPedals.length === 0 && wishlistPedals.length === 0)) return;

    const allTracked = [...ownedPedals, ...wishlistPedals];
    const pedalIds = [...new Set(allTracked.map(p => p.pedal_id))];

    // 1. Load whatever is already cached in the DB
    const { data: cached } = await supabase
      .from('pedal_market_data')
      .select('pedal_id, market_value, updated_at')
      .in('pedal_id', pedalIds);

    const cachedMap = new Map((cached ?? []).map(c => [c.pedal_id, c]));
    const valueMap: Record<string, number> = {};
    const staleIds: string[] = [];

    for (const up of ownedPedals) {
      const hit = cachedMap.get(up.pedal_id);
      if (hit?.market_value) {
        valueMap[up.pedal_id] = hit.market_value;
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

    // Update UI immediately with cached values
    const initialTotal = Object.values(valueMap).reduce((a, b) => a + b, 0);
    set({
      marketValues: { ...valueMap },
      totalMarketValue: initialTotal,
      wishlistDropCount: calcWishlistDrops(valueMap),
    });

    // 2. Refresh stale/missing via edge function
    for (const up of allTracked.filter(p => staleIds.includes(p.pedal_id))) {
      if (!up.pedal) continue;
      try {
        const { data } = await invokeEdgeFunction('market-value', {
          pedal_id: up.pedal_id,
          brand: up.pedal.brand,
          model: up.pedal.model,
        });
        if (data?.market_value) {
          const { marketValues: current } = get();
          const updated = { ...current, [up.pedal_id]: data.market_value };
          set({
            marketValues: updated,
            totalMarketValue: Object.values(updated).reduce((a, b) => a + b, 0),
            wishlistDropCount: calcWishlistDrops(updated),
          });
        }
      } catch {
        // Market data is non-critical — fail silently
      }
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
      const fetched = await Promise.all(needsFetch.map(async ({ id, path }) => {
        const thumbPath = path.replace(/\.[^/.]+$/, '_sm.jpg');
        const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
        const url = data?.signedUrl ?? '';
        if (url) {
          cache[path] = { url, expiresAt: now + 7 * 24 * 60 * 60 * 1000 };
        }
        const { data: thumbData } = await supabase.storage.from(bucket).createSignedUrl(thumbPath, 60 * 60 * 24 * 7);
        const thumbUrl = thumbData?.signedUrl ?? '';
        if (thumbUrl) {
          cache[thumbPath] = { url: thumbUrl, expiresAt: now + 7 * 24 * 60 * 60 * 1000 };
        }
        if (thumbUrl) {
          thumbResults.push([id, thumbUrl] as const);
        } else if (url) {
          thumbResults.push([id, url] as const);
        }
        return [id, url] as const;
      }));
      results.push(...fetched);
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
    const { session, ownedPedals, wishlistPedals, retiredPedals } = get();
    if (!session?.user) return;

    // Collect unique pedals without an image (limit to 8 per run to avoid hammering Reverb)
    const seen = new Set<string>();
    const missing: { id: string; brand: string; model: string }[] = [];
    for (const up of [...ownedPedals, ...wishlistPedals, ...retiredPedals]) {
      if (up.pedal && !up.pedal.image_url && !seen.has(up.pedal.id)) {
        seen.add(up.pedal.id);
        missing.push({ id: up.pedal.id, brand: up.pedal.brand, model: up.pedal.model });
      }
    }

    for (const p of missing.slice(0, 8)) {
      try {
        const { data } = await invokeEdgeFunction('search-pedals', {
          query: `${p.brand} ${p.model}`,
        });
        const photoUrl: string | undefined = (data?.results as { photo_url?: string }[])?.[0]?.photo_url;
        if (!photoUrl) continue;

        // Persist to DB
        await supabase.from('pedals').update({ image_url: photoUrl }).eq('id', p.id);

        // Update all three lists in local state
        const patch = (list: UserPedal[]) =>
          list.map(up =>
            up.pedal?.id === p.id ? { ...up, pedal: { ...up.pedal!, image_url: photoUrl } } : up
          );
        set(s => ({
          ownedPedals: patch(s.ownedPedals),
          wishlistPedals: patch(s.wishlistPedals),
          retiredPedals: patch(s.retiredPedals),
        }));
      } catch {
        // Non-critical — skip silently
      }
    }
  },

  // ─── Wishlist ────────────────────────────────────────────────────────────────

  addToWishlist: async (brand, model, catalogData?) => {
    const { session } = get();
    if (!session?.user) return 'error';

    let pedalId: string | null = null;

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

      return fuzzy?.[0]?.id ?? null;
    };

    // Auto-upsert via edge function (also enriches image_url)
    if (catalogData) {
      const { data, error } = await invokeEdgeFunction('search-pedals', {
        action: 'upsert',
        brand,
        model,
        category: catalogData.category,
        subcategory: catalogData.subcategory,
        description: catalogData.description,
        analog: catalogData.analog,
        avg_price: catalogData.price,
        in_production: true,
      });
      if (!error && data?.pedal?.id) {
        pedalId = data.pedal.id as string;
      } else {
        if (__DEV__) console.warn('[Store] addToWishlist upsert error (catalogData):', error);
        // Fallback 1: existing row lookup
        pedalId = await findExistingPedalId();
        // Fallback 2: service-role upsert with minimal metadata
        if (!pedalId) {
          const { data: retryData, error: retryErr } = await invokeEdgeFunction('search-pedals', {
            action: 'upsert',
            brand,
            model,
            category: catalogData.category || 'other',
            subcategory: catalogData.subcategory || 'Recommended',
            description: catalogData.description || null,
            analog: catalogData.analog ?? false,
            avg_price: catalogData.price ?? null,
            in_production: true,
          });
          if (!retryErr && retryData?.pedal?.id) {
            pedalId = retryData.pedal.id as string;
          } else {
            if (__DEV__) console.warn('[Store] addToWishlist retry upsert error:', retryErr);
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
        const { data, error } = await invokeEdgeFunction('search-pedals', {
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
          if (__DEV__) console.warn('[Store] addToWishlist upsert error (no catalogData):', error);
          // One more try with fuzzy lookup before giving up
          pedalId = await findExistingPedalId();
          if (!pedalId) return 'not_found';
        } else {
          pedalId = data.pedal.id as string;
        }
      }
    }
    if (!pedalId) return 'error';

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
    const { error } = await supabase
      .from('user_pedals')
      .insert({
        user_id: session.user.id,
        pedal_id: pedalId,
        status: 'wishlist',
        target_price: catalogData?.price ?? null,
      });

    if (error) return 'error';

    // Refresh store
    await get().fetchPedals();
    return 'added';
  },

  // ─── Sign Out ───────────────────────────────────────────────────────────────
  signOut: async () => {
    await supabase.auth.signOut();
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
AsyncStorage.getItem('tpc_view_mode')
  .then((mode) => {
    if (mode === 'tile' || mode === 'text') {
      useStore.setState({ viewMode: mode });
    }
  })
  .catch(() => {});

AsyncStorage.getItem('tpc_last_custom_shop_pick')
  .then((raw) => {
    if (raw) useStore.setState({ lastCustomShopPick: JSON.parse(raw) });
  })
  .catch(() => {});
