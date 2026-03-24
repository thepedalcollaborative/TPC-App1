import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const extra =
  Constants.expoConfig?.extra ??
  (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra ??
  (Constants as unknown as { expoGoConfig?: { extra?: Record<string, unknown> } }).expoGoConfig?.extra ??
  {};

const supabaseUrl = (extra.supabaseUrl as string) ?? '';
const supabaseAnonKey = (extra.supabaseAnonKey as string) ?? '';

if (__DEV__) {
  const keyPreview = supabaseAnonKey ? `${supabaseAnonKey.slice(0, 10)}…${supabaseAnonKey.slice(-6)}` : 'missing';
  console.log('[TPC] Supabase config', { supabaseUrl, supabaseAnonKey: keyPreview });
}

// Guard: ensure Supabase URL uses HTTPS so tokens are never sent over plaintext
if (!supabaseUrl?.startsWith('https://')) {
  throw new Error('[TPC] Supabase URL must use HTTPS. Check app.json extra.supabaseUrl.');
}

// Chunking SecureStore adapter — splits values > 2048 bytes across multiple keys
// to stay within SecureStore's per-item size limit (Keychain/Keystore restriction).
const CHUNK_SIZE = 1800; // conservative margin below 2048

const SecureStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    const first = await SecureStore.getItemAsync(key);
    if (first === null) return null;
    // Check if this was chunked
    const meta = await SecureStore.getItemAsync(`${key}__chunks`);
    if (!meta) return first;
    const count = parseInt(meta, 10);
    let result = first;
    for (let i = 1; i < count; i++) {
      const chunk = await SecureStore.getItemAsync(`${key}__${i}`);
      result += chunk ?? '';
    }
    return result;
  },

  setItem: async (key: string, value: string): Promise<void> => {
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      await SecureStore.deleteItemAsync(`${key}__chunks`);
      return;
    }
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(key, chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, chunks[i]);
    }
    await SecureStore.setItemAsync(`${key}__chunks`, String(chunks.length));
  },

  removeItem: async (key: string): Promise<void> => {
    const meta = await SecureStore.getItemAsync(`${key}__chunks`);
    if (meta) {
      const count = parseInt(meta, 10);
      for (let i = 1; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}__${i}`);
      }
      await SecureStore.deleteItemAsync(`${key}__chunks`);
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export function invokeEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>
) {
  return (async () => {
    const getAccessToken = async (): Promise<string | null> => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.access_token) return sessionData.session.access_token;
      // One recovery attempt for stale in-memory auth state.
      await supabase.auth.refreshSession();
      const { data: refreshed } = await supabase.auth.getSession();
      return refreshed.session?.access_token ?? null;
    };

    const run = async () => {
      const accessToken = await getAccessToken();
      return supabase.functions.invoke<T>(name, {
        body,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
    };

    let res = await run();
    const status = (res.error as { context?: { status?: number } } | null)?.context?.status;
    if (status === 401) {
      // One retry after refresh for stale access tokens.
      await supabase.auth.refreshSession();
      res = await run();
    }
    return res;
  })();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type Pedal = {
  id: string;
  brand: string;
  model: string;
  category: string;
  subcategory: string;
  description: string | null;
  controls: string[] | null;
  power: string | null;
  true_bypass: boolean | null;
  analog: boolean;
  price_tier: string | null;
  avg_price: number | null;
  in_production: boolean;
  image_url: string | null;
};

export type PedalColorway = {
  id: string;
  pedal_id: string;
  name: string;
  image_url: string | null;
  color_hex: string | null;
  is_default: boolean;
  year_released: number | null;
  notes: string | null;
  is_pending: boolean;
  duplicate_of: string | null;
};

export type UserPedal = {
  id: string;
  user_id: string;
  pedal_id: string;
  status: 'owned' | 'wishlist' | 'retired';
  purchase_price: number | null;
  condition: string | null;
  notes: string | null;
  acquired_method: 'purchase' | 'trade' | null;
  acquired_from: string | null;
  acquired_trade_for: string | null;
  acquired_trade_with: string | null;
  target_price: number | null;
  colorway_id: string | null;
  acquired_date: string | null;
  retired_date: string | null;
  retired_method: 'sale' | 'trade' | null;
  retired_price: number | null;
  retired_trade_for: string | null;
  retired_to: string | null;
  retired_notes: string | null;
  on_current_board: boolean | null;
  user_image_path: string | null;
  category_override: string | null;
  serial_number: string | null;
  traded_from_user_pedal_id: string | null;
  trade_cash_paid: number | null;
  created_at: string;
  pedal?: Pedal;
  colorway?: PedalColorway;
};

export type Board = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string | null;
  board_image_path: string | null;
  created_at: string;
  slots?: BoardSlot[];
};

export type BoardSlot = {
  id: string;
  board_id: string;
  pedal_id: string;
  position: number;
  created_at?: string;
  pedal?: Pedal;
};

export type FullExpertProfile = {
  // ── Onboarding answers ──────────────────────────────────────────────────────
  experience_years: string;
  year_started: string;        // 4-digit year — optional brag field on Q1
  tone_identity: string;       // free text — inject verbatim into prompts
  guitar_heroes: string;       // free text — highest-weight field in all prompts
  sonic_moments: string[];     // multi-select, up to 3
  guitar_type: string;
  guitar_details: string;      // free text — specific guitars owned
  amp_type: string;
  amp_details: string;         // free text — specific amps owned
  signal_chain: string;        // stereo / mono preference
  genres: string[];            // multi-select, unlimited
  board_philosophy: string;
  brand_attitude: string;
  complexity_tolerance: string;
  budget_range: string;
  tone_chase: string;          // free text — equal weight to guitar_heroes

  // ── Timestamps ──────────────────────────────────────────────────────────────
  onboarding_completed_at: string;    // ISO
  profile_updated_at: string;         // ISO
  profile_refresh_due_at: string;     // ISO — 6 months from completion
  onboarding_skipped_at?: string;     // ISO — suppresses re-prompt for 7 days
};

export type UserProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  is_admin: boolean;
  is_premium: boolean;
  pedal_finder_uses_today: number;
  pedal_expert_profile: FullExpertProfile | null;
  created_at: string;
};
