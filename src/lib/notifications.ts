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
const ID_WEEKLY_PICK = 'tpc-weekly-pick';
const ID_VAULT_DIGEST = 'tpc-vault-digest';

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

/** Remove all TPC scheduled notifications (e.g. on sign-out). */
export async function cancelAllTpcNotifications(): Promise<void> {
  await Promise.all([
    Notifications.cancelScheduledNotificationAsync(ID_WEEKLY_PICK).catch(() => {}),
    Notifications.cancelScheduledNotificationAsync(ID_VAULT_DIGEST).catch(() => {}),
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
