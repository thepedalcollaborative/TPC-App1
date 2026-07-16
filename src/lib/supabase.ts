import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { isAffectedIOSVersion } from './iosVersion';

// On iOS 26.0–26.5 expo-secure-store hits the same TurboModule exception-propagation
// crash that affected react-native-purchases. Fall back to AsyncStorage so no
// Keychain TurboModule calls happen on launch on affected devices.
const USE_SECURE_STORE = !isAffectedIOSVersion();

const extra =
  Constants.expoConfig?.extra ??
  (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra ??
  (Constants as unknown as { expoGoConfig?: { extra?: Record<string, unknown> } }).expoGoConfig?.extra ??
  {};

const supabaseUrl = (extra.supabaseUrl as string) ?? '';
const supabaseAnonKey = (extra.supabaseAnonKey as string) ?? '';

// Guard: ensure Supabase URL uses HTTPS so tokens are never sent over plaintext
if (!supabaseUrl?.startsWith('https://')) {
  throw new Error('[TPC] Supabase URL must use HTTPS. Check app.json extra.supabaseUrl.');
}

// Chunking SecureStore adapter — splits values > 2048 bytes across multiple keys
// to stay within SecureStore's per-item size limit (Keychain/Keystore restriction).
// On iOS 26.0–26.5 all SecureStore paths are replaced with AsyncStorage to avoid
// the TurboModule crash; chunking is not needed there (AsyncStorage has no size cap).
const CHUNK_SIZE = 1800;

const SecureStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (!USE_SECURE_STORE) return AsyncStorage.getItem(key);
    const first = await SecureStore.getItemAsync(key);
    if (first === null) return null;
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
    if (!USE_SECURE_STORE) { await AsyncStorage.setItem(key, value); return; }
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
    if (!USE_SECURE_STORE) { await AsyncStorage.removeItem(key); return; }
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

export { SecureStorageAdapter };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Explicit PKCE — required for native OAuth so the callback returns
    // a ?code= query param instead of tokens in the URL hash (implicit flow).
    flowType: 'pkce',
  },
});

// ─── Auth header cache ────────────────────────────────────────────────────────
// Supabase JWTs are valid for 1 hour; we cache for 4 minutes to avoid
// redundant SecureStore reads on rapid successive edge function calls.
// Cleared on every auth state change (sign-in / sign-out / token refresh).
let _cachedAuthHeader: { header: Record<string, string>; expiresAt: number } | null = null;

supabase.auth.onAuthStateChange(() => {
  _cachedAuthHeader = null;
});

export async function getEdgeAuthHeaders(): Promise<Record<string, string>> {
  const now = Date.now();
  if (_cachedAuthHeader && _cachedAuthHeader.expiresAt > now) {
    return _cachedAuthHeader.header;
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const header: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  if (token) {
    _cachedAuthHeader = { header, expiresAt: now + 4 * 60 * 1000 }; // 4 min
  }
  return header;
}

// Public profile share URL. Currently served by the public-profile edge function;
// when app.thepedalcollaborative.com goes live, change this one function and every
// share flow in the app follows.
export function publicProfileUrl(username: string): string {
  return `${supabaseUrl}/functions/v1/public-profile?u=${encodeURIComponent(username)}`;
}

export function invokeEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>
) {
  return (async () => {
    const run = async () => {
      const headers = await getEdgeAuthHeaders();
      return supabase.functions.invoke<T>(name, { body, headers });
    };

    const readErrorContext = async (error: unknown): Promise<{ status?: number; body: string }> => {
      const anyErr = error as { context?: { status?: number; text?: () => Promise<string> } } | null;
      const status = anyErr?.context?.status;
      let body = '';
      if (anyErr?.context?.text) {
        try { body = await anyErr.context.text(); } catch {}
      }
      return { status, body };
    };

    const first = await run();
    if (!first.error) return first;

    // Token can be stale during refresh races in Expo Go.
    // Retry once for any 401 from edge functions.
    const firstCtx = await readErrorContext(first.error);
    const isUnauthorized401 = firstCtx.status === 401;

    if (!isUnauthorized401) return first;

    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session?.access_token) return first;

    const second = await run();
    return second;
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
  /** Where the image came from — used to prefer higher-quality sources */
  image_source: 'manufacturer' | 'preferred_seller' | 'reverb_listing' | 'user_contributed' | null;
  /** Path in the 'pedal-images' Supabase Storage bucket (permanent copy) */
  image_storage_path: string | null;
  /** Hardware revision, firmware version, or other "which variant" label (e.g. "MKII") */
  version_label: string | null;
  manual_url: string | null;
  /** Path in the 'pedal-manuals' Supabase Storage bucket (permanent copy) */
  manual_storage_path: string | null;
  is_verified: boolean;
  merged_into: string | null;
  tone_dna: string | null;
  manual_text: string | null;
  midi_manual_url: string | null;
  quick_start_url: string | null;
  dimensions: string | null;
  weight: string | null;
  power_requirements: string | null;
  mono_stereo: 'mono' | 'stereo' | 'mono_in_stereo_out' | null;
  midi: boolean | null;
  midi_notes: string | null;
  presets: boolean | null;
  preset_count: number | null;
  price_usd: number | null;
  release_year: number | null;
  manufacturer_sku: string | null;
  product_url: string | null;
};

export type PedalPhoto = {
  id: string;
  pedal_id: string;
  url: string;
  storage_path: string | null;
  position: number;
  created_at: string;
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
  listing_status: 'for_sale' | 'for_trade' | 'for_sale_or_trade' | null;
  asking_price: number | null;
  trade_wants: string | null;
  loaned_to: string | null;
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
  pro_source?: string | null;
  pedal_finder_uses_today: number;
  pedal_expert_profile: FullExpertProfile | null;
  allow_activity_in_trends: boolean;
  is_public_profile: boolean;
  created_at: string;
};

// ─── Conversation history (Pro users) ────────────────────────────────────────

export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type Conversation = {
  id: string;
  user_id: string;
  title: string;
  messages: ConversationMessage[];
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
};

/** Create a new conversation row and return its id */
export async function createConversation(
  userId: string,
  title: string,
  messages: ConversationMessage[],
): Promise<string | null> {
  const preview = messages.findLast(m => m.role === 'assistant')?.content?.slice(0, 120) ?? null;
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title,
      messages,
      last_message_preview: preview,
    })
    .select('id')
    .single();
  if (error) { if (__DEV__) console.warn('[conversations] create error:', error); return null; }
  return data?.id ?? null;
}

/** Append new messages to an existing conversation */
export async function updateConversation(
  id: string,
  messages: ConversationMessage[],
): Promise<void> {
  const preview = messages.findLast(m => m.role === 'assistant')?.content?.slice(0, 120) ?? null;
  const { error } = await supabase
    .from('conversations')
    .update({ messages, last_message_preview: preview })
    .eq('id', id);
  if (error && __DEV__) console.warn('[conversations] update error:', error);
}

/** Load all conversations for a user, newest first */
export async function fetchConversations(userId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) { if (__DEV__) console.warn('[conversations] fetch error:', error); return []; }
  return (data ?? []) as Conversation[];
}

/** Load a single conversation by id */
export async function fetchConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .single();
  if (error) { if (__DEV__) console.warn('[conversations] fetchOne error:', error); return null; }
  return data as Conversation;
}

/** Delete a conversation */
export async function deleteConversation(id: string): Promise<void> {
  await supabase.from('conversations').delete().eq('id', id);
}
