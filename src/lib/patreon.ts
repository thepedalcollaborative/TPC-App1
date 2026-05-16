/**
 * Patreon OAuth — account linking (not sign-in).
 *
 * Flow:
 *   1. Open Patreon auth in browser via WebBrowser.openAuthSessionAsync
 *   2. Patreon redirects to the `patreon-redirect` Edge Function (HTTPS URL)
 *   3. Edge function 302-redirects to tpc://auth-callback?code=XXX&state=YYY
 *   4. openAuthSessionAsync intercepts the tpc:// deep link and returns it
 *   5. We send the code to the `patreon-connect` edge function
 *   6. Edge function exchanges code server-side (keeps client secret safe),
 *      checks membership tier, and updates user_profiles.is_premium + pro_source
 *   7. Caller refreshes profile to reflect new Pro status
 *
 * Why two URIs?
 *   Patreon's developer portal only accepts http/https redirect URIs — it
 *   rejects custom schemes like tpc://.  We register the HTTPS edge function
 *   URL with Patreon.  That function simply 302s to the deep link, which
 *   openAuthSessionAsync intercepts via its callbackUrl parameter.
 *
 * Required Supabase secrets (set via `npx supabase secrets set`):
 *   PATREON_CLIENT_ID
 *   PATREON_CLIENT_SECRET
 *   PATREON_PRO_TIER_IDS   (comma-separated Patreon tier IDs that grant Pro)
 *                           Optional: if empty, any active patron gets Pro
 */

import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { invokeEdgeFunction } from './supabase';

const extra =
  Constants.expoConfig?.extra ??
  (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra ??
  {};

const PATREON_CLIENT_ID =
  ((extra as Record<string, unknown>)?.patreonClientId as string) ?? '';

/**
 * The HTTPS URL registered in the Patreon developer portal.
 * Patreon sends the OAuth callback here; the function then 302s to APP_DEEP_LINK.
 */
const REDIRECT_URI =
  'https://skejiotfywhmnvsivfsk.supabase.co/functions/v1/patreon-redirect';

/**
 * The deep link that openAuthSessionAsync watches for.
 * The patreon-redirect edge function redirects here so the in-app browser
 * intercepts it and hands the code back to the app.
 */
const APP_DEEP_LINK = 'tpc://auth-callback';

// Patreon v2 scopes: memberships must be requested as "identity.memberships"
const PATREON_SCOPES = 'identity identity[email] identity.memberships';

export type PatreonConnectResult =
  | { success: true;  isPro: boolean; tier: string | null }
  | { success: false; cancelled?: boolean; error?: string };

/**
 * Launches the Patreon OAuth flow and links the account.
 * Returns the result; caller is responsible for calling fetchProfile() on success.
 */
export async function connectPatreon(): Promise<PatreonConnectResult> {
  if (!PATREON_CLIENT_ID) {
    return {
      success: false,
      error: 'Patreon is not configured yet. Set patreonClientId in app.json.',
    };
  }

  // Generate a random state value to prevent CSRF
  const state = `patreon_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const authUrl = new URL('https://www.patreon.com/oauth2/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', PATREON_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', PATREON_SCOPES);
  authUrl.searchParams.set('state', state);

  const result = await WebBrowser.openAuthSessionAsync(
    authUrl.toString(),
    APP_DEEP_LINK,   // watch for this deep link — the edge function 302s here
  );

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { success: false, cancelled: true };
  }

  if (result.type !== 'success' || !result.url) {
    return { success: false, error: 'Patreon authorization failed.' };
  }

  const redirected = new URL(result.url);
  const code = redirected.searchParams.get('code');
  const returnedState = redirected.searchParams.get('state');
  const oauthError = redirected.searchParams.get('error');

  if (oauthError) {
    return { success: false, error: `Patreon denied access: ${oauthError}` };
  }

  if (!code) {
    return { success: false, error: 'No authorization code returned by Patreon.' };
  }

  if (returnedState !== state) {
    return { success: false, error: 'State mismatch — possible CSRF attack.' };
  }

  // Exchange the code server-side (client secret never touches the app)
  const { data, error } = await invokeEdgeFunction('patreon-connect', {
    code,
    redirectUri: REDIRECT_URI,
  });

  if (error || !data) {
    if (__DEV__) console.warn('[Patreon] edge function error:', error);
    return { success: false, error: 'Failed to verify Patreon membership.' };
  }

  const d = data as { isPro: boolean; tier: string | null; error?: string };
  if (d.error) {
    return { success: false, error: d.error };
  }

  return { success: true, isPro: d.isPro, tier: d.tier };
}
