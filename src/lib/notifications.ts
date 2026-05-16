/**
 * TPC push notification scheduling.
 *
 * All notifications are locally scheduled — no server required.
 *
 * Scheduled notifications:
 *   1. Weekly Pick reminder  — Monday 9 am (repeating weekly)
 *   2. Vault digest          — Sunday 6 pm (repeating weekly)
 *
 * Future (server-side APNs/FCM required):
 *   3. Re-engagement         — after 4 days without opening
 *   4. Wishlist price drops  — when Reverb price falls
 *   5. Board activity        — when a collaborator edits a shared board
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// Show alerts while app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Stable identifiers so we can cancel/replace without cancelling all
const ID_WEEKLY_PICK    = 'tpc-weekly-pick';
const ID_VAULT_DIGEST   = 'tpc-vault-digest';
const ID_REENGAGEMENT  = 'tpc-reengagement';

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'TPC Notifications',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Get the Expo push token and save it to user_profiles.
 * Safe to call repeatedly — Supabase upsert is idempotent.
 * Only works on a real device with permissions granted.
 */
export async function savePushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token?.data) {
      await supabase
        .from('user_profiles')
        .update({ push_token: token.data })
        .eq('id', userId);
    }
  } catch {
    // Non-critical — fail silently
  }
}

/**
 * Schedule the Monday 9 am weekly pick reminder.
 * Call this once after permissions are granted — it repeats automatically.
 */
export async function scheduleWeeklyPickNotification(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ID_WEEKLY_PICK).catch(() => {});

  await Notifications.scheduleNotificationAsync({
    identifier: ID_WEEKLY_PICK,
    content: {
      title: 'Your Weekly Pick is Ready ✦',
      body: "This week's AI-curated pedal recommendation is waiting for you.",
      data: { screen: 'AIHub' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 2, // 1=Sun, 2=Mon … 7=Sat (Expo/iOS convention)
      hour: 9,
      minute: 0,
    },
  });
}

/**
 * Schedule the Sunday 6 pm vault digest.
 * Pass current pedal count and estimated value for a personalised body line.
 */
export async function scheduleVaultDigestNotification(
  pedalCount: number,
  estimatedValue: number,
): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ID_VAULT_DIGEST).catch(() => {});

  const body =
    estimatedValue > 0
      ? `${pedalCount} pedals · Est. value $${Math.round(estimatedValue).toLocaleString()}. Check your picks.`
      : `${pedalCount} pedal${pedalCount !== 1 ? 's' : ''} in your vault. Keep building.`;

  await Notifications.scheduleNotificationAsync({
    identifier: ID_VAULT_DIGEST,
    content: {
      title: 'Your Vault This Week',
      body,
      data: { screen: 'Vault' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1, // Sunday
      hour: 18,
      minute: 0,
    },
  });
}

/**
 * Schedule a one-shot re-engagement notification 4 days from now.
 * Call this every time the app comes to foreground while the user is signed in —
 * it cancels the previous trigger and resets the 4-day clock, so the notification
 * only fires after 4 consecutive days without an app open.
 *
 * @param gasListCount  Number of pedals on the user's GAS / wishlist
 */
export async function scheduleReengagementNotification(gasListCount: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ID_REENGAGEMENT).catch(() => {});

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const body =
    gasListCount > 0
      ? `Your GAS List has ${gasListCount} pedal${gasListCount !== 1 ? 's' : ''} waiting 🔥`
      : "Your rig isn't going to build itself. 🎸";

  await Notifications.scheduleNotificationAsync({
    identifier: ID_REENGAGEMENT,
    content: {
      title: "Haven't seen you in a while…",
      body,
      data: { screen: 'Vault' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 4 * 24 * 60 * 60, // 4 days
      repeats: false,
    },
  });
}

/** Remove all TPC scheduled notifications (e.g. on sign-out). */
export async function cancelAllTpcNotifications(): Promise<void> {
  await Promise.all([
    Notifications.cancelScheduledNotificationAsync(ID_WEEKLY_PICK).catch(() => {}),
    Notifications.cancelScheduledNotificationAsync(ID_VAULT_DIGEST).catch(() => {}),
    Notifications.cancelScheduledNotificationAsync(ID_REENGAGEMENT).catch(() => {}),
  ]);
}

/**
 * Days until the next Monday from today.
 * Returns 7 if today is Monday (pick just refreshed).
 */
export function daysUntilNextMonday(): number {
  const day = new Date().getDay(); // 0=Sun … 6=Sat
  if (day === 1) return 7;        // just refreshed today
  if (day === 0) return 1;        // tomorrow
  return 8 - day;
}

/** Human-readable countdown label for the weekly pick card. */
export function weeklyPickCountdownLabel(): string {
  const days = daysUntilNextMonday();
  if (days === 7) return 'Fresh this week';
  if (days === 1) return 'New pick tomorrow';
  return `New pick in ${days} days`;
}
