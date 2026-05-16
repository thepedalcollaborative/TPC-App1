/**
 * networkError.ts
 *
 * Classifies network failures into actionable categories so the app can show
 * the right message rather than a generic "Something went wrong".
 *
 * Detection strategy (no extra packages needed):
 *  - Offline:        React Native's fetch throws "Network request failed" when
 *                    the device has no internet (iOS + Android, airplane mode
 *                    or no signal).
 *  - Server error:   HTTP 5xx from edge functions or Supabase.
 *  - Auth error:     HTTP 401 / 403 — session expired or revoked.
 *  - Rate limited:   HTTP 429.
 *  - External down:  Downstream API (e.g. Reverb) returned an error, but OUR
 *                    backend is fine — flagged via the _debug.stage field.
 *  - Empty:          200 OK but the result set is just empty (not an error).
 *  - Unknown:        Catch-all.
 */

import { Alert } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NetworkErrorType =
  | 'offline'
  | 'server'
  | 'external'
  | 'auth'
  | 'rate_limited'
  | 'empty'
  | 'unknown';

export interface ClassifiedError {
  type: NetworkErrorType;
  title: string;
  message: string;
  /** Ionicons name */
  icon: string;
  /** Whether the user should try again — show a Retry button when true */
  retryable: boolean;
}

// ─── Offline patterns ─────────────────────────────────────────────────────────
// These are the exact strings React Native and Supabase surface when the device
// has no internet connection.
const OFFLINE_SUBSTRINGS = [
  'network request failed',  // RN fetch — offline
  'failed to fetch',         // some environments
  'network error',           // axios-style
  'networkerror',
  'could not connect',
  'connection refused',
  'no internet',
];

// ─── Classifier ───────────────────────────────────────────────────────────────

export function classifyError(
  error: unknown,
  opts?: {
    httpStatus?: number;
    /** Pass _debug.stage from edge functions to detect external API failures */
    externalApiStage?: string;
  }
): ClassifiedError {
  const raw = (error as Error)?.message ?? String(error ?? '');
  const msg = raw.toLowerCase();
  const status = opts?.httpStatus;

  // 1. Offline — check error message first (the most reliable signal)
  if (OFFLINE_SUBSTRINGS.some(p => msg.includes(p))) {
    return {
      type: 'offline',
      title: 'No internet connection',
      message: "You appear to be offline. Check your connection and try again.",
      icon: 'wifi-outline',
      retryable: true,
    };
  }

  // 2. HTTP 401 / 403 — auth
  if (status === 401 || status === 403) {
    return {
      type: 'auth',
      title: 'Session expired',
      message: 'Please sign out and sign back in to continue.',
      icon: 'lock-closed-outline',
      retryable: false,
    };
  }

  // 3. HTTP 429 — rate limited
  if (status === 429) {
    return {
      type: 'rate_limited',
      title: 'Too many requests',
      message: 'You\'ve hit a rate limit. Wait a moment and try again.',
      icon: 'time-outline',
      retryable: true,
    };
  }

  // 4. External downstream API failure (e.g. Reverb is down, but our server is fine)
  if (opts?.externalApiStage) {
    return {
      type: 'external',
      title: 'Marketplace unavailable',
      message: 'The listing source is temporarily down. Try again in a moment.',
      icon: 'cloud-offline-outline',
      retryable: true,
    };
  }

  // 5. HTTP 5xx — our server
  if (status && status >= 500) {
    return {
      type: 'server',
      title: 'Server error',
      message: "Something went wrong on our end. Try again in a moment.",
      icon: 'cloud-offline-outline',
      retryable: true,
    };
  }

  // 6. Catch-all
  return {
    type: 'unknown',
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Try again.',
    icon: 'alert-circle-outline',
    retryable: true,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract HTTP status from invokeEdgeFunction / Supabase error objects */
export function extractHttpStatus(error: unknown): number | undefined {
  return (error as { context?: { status?: number } })?.context?.status;
}

/**
 * Read the raw body from an edge function error (for logging / stage detection).
 * Returns '' if unavailable.
 */
export async function extractErrorBody(error: unknown): Promise<string> {
  try {
    const text = (error as { context?: { text?: () => Promise<string> } })?.context?.text;
    if (text) return await text();
  } catch {}
  return '';
}

/**
 * Show an Alert for offline errors.
 * Use this for actions where there's no inline error display (e.g. a save button tap).
 */
export function alertIfOffline(classified: ClassifiedError): boolean {
  if (classified.type === 'offline') {
    Alert.alert(classified.title, classified.message);
    return true;
  }
  return false;
}
