import notifee, {
  AlarmType,
  AndroidCategory,
  AndroidImportance,
  AuthorizationStatus,
  EventType,
  TriggerType,
  type Event,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { occurrences, type Medication } from './domain';
import { loadState, recordDose } from './storage';

const CHANNEL_ID = 'medirecord-reminders';
export const ACTION_TAKEN = 'medirecord.action.TAKEN';
export const ACTION_SNOOZE = 'medirecord.action.SNOOZE';
const SNOOZE_MS = 10 * 60 * 1000;
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 50;
const ALARM_FALLBACK_MIN_AHEAD_MS = 15 * 1000;

interface ReminderData {
  medicationId: string;
  scheduledAt: number;
  snoozedFrom?: number;
}

function reminderId(medicationId: string, scheduledAt: number): string {
  return `dose-${medicationId}-${scheduledAt}`;
}

function isActionableMedication(med: Medication, now: number): boolean {
  if (!med.active) {
    return false;
  }
  if (med.endAt !== undefined && med.endAt < now) {
    return false;
  }
  return true;
}

async function getAlarmPermissionEnabled(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    const settings = await notifee.getNotificationSettings();
    return settings.android.alarm !== 0;
  } catch {
    return false;
  }
}

export async function requestNotifications(): Promise<boolean> {
  const settings = await notifee.requestPermission({
    alert: true,
    sound: true,
    badge: true,
  });
  const granted = settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
  if (granted && Platform.OS === 'android') {
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'Medication reminders',
      importance: AndroidImportance.HIGH,
      sound: 'default',
    });
  }
  return granted;
}

export async function handleNotificationEvent(event: Event): Promise<void> {
  const notification = event.detail.notification;
  if (!notification) {
    return;
  }
  const data = notification.data as Partial<ReminderData> | undefined;
  if (!data || typeof data.medicationId !== 'string') {
    return;
  }
  const medicationId = data.medicationId;
  const scheduledAt = Number(data.scheduledAt);
  if (!Number.isFinite(scheduledAt)) {
    return;
  }
  if (event.type === EventType.ACTION_PRESS) {
    const actionId: string | undefined = event.detail.pressAction?.id;
    if (actionId === ACTION_TAKEN) {
      await recordDose(medicationId, scheduledAt, 'taken');
      if (notification.id) {
        await notifee.cancelDisplayedNotification(notification.id);
      }
    } else if (actionId === ACTION_SNOOZE) {
      await notifee.cancelDisplayedNotification(notification.id!);
      await snooze(medicationId, scheduledAt);
    }
  }
}

export async function snooze(medicationId: string, scheduledAt: number): Promise<void> {
  const state = await loadState();
  const med = state.medications.find((m) => m.id === medicationId);
  if (!med) {
    return;
  }
  const now = Date.now();
  const fireAt = now + SNOOZE_MS;
  await notifee.createTriggerNotification(
    {
      id: reminderId(medicationId, scheduledAt),
      title: med.name,
      body: `Snoozed reminder - time to take ${med.name}`,
      data: { medicationId, scheduledAt, snoozedFrom: scheduledAt },
      android: {
        channelId: CHANNEL_ID,
        category: AndroidCategory.REMINDER,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'default' },
        actions: [
          { title: 'Taken', pressAction: { id: ACTION_TAKEN } },
          { title: 'Snooze', pressAction: { id: ACTION_SNOOZE } },
        ],
      },
      ios: {
        categoryId: 'medirecord-reminder',
        sound: 'default',
      },
    },
    { type: TriggerType.TIMESTAMP, timestamp: fireAt, alarmManager: { type: AlarmType.SET_EXACT } },
  );
}

export async function syncNotifications(): Promise<void> {
  const now = Date.now();
  const state = await loadState();
  const existing = await notifee.getTriggerNotifications();
  const snoozedKeys = new Set<string>();
  for (const tn of existing) {
    const data = tn.notification.data as Partial<ReminderData> | undefined;
    if (data?.snoozedFrom !== undefined && data.medicationId && data.scheduledAt) {
      snoozedKeys.add(`${data.medicationId}:${data.scheduledAt}`);
    }
  }
  await notifee.cancelTriggerNotifications(
    existing
      .map((tn) => tn.notification.id)
      .filter((id): id is string => typeof id === 'string')
      .filter((id) => {
        const tn = existing.find((t) => t.notification.id === id);
        const data = tn?.notification.data as Partial<ReminderData> | undefined;
        return data?.snoozedFrom === undefined;
      }),
  );
  const horizonEnd = now + HORIZON_MS;
  const candidates: Array<{ med: Medication; ts: number }> = [];
  for (const med of state.medications) {
    if (!isActionableMedication(med, now)) {
      continue;
    }
    const times = occurrences(med, now, horizonEnd);
    for (const ts of times) {
      if (ts <= now) {
        continue;
      }
      const recorded = state.doses.some(
        (d) => d.medicationId === med.id && d.scheduledAt === ts,
      );
      if (recorded) {
        continue;
      }
      candidates.push({ med, ts });
    }
  }
  candidates.sort((a, b) => a.ts - b.ts);
  const alarmEnabled = await getAlarmPermissionEnabled();
  const triggerBase = { type: TriggerType.TIMESTAMP } as const;
  let scheduled = 0;
  for (const { med, ts } of candidates) {
    if (scheduled >= MAX_REMINDERS) {
      break;
    }
    if (snoozedKeys.has(`${med.id}:${ts}`)) {
      continue;
    }
    const useAlarm = alarmEnabled && ts - now > ALARM_FALLBACK_MIN_AHEAD_MS;
    await notifee.createTriggerNotification(
      {
        id: reminderId(med.id, ts),
        title: med.name,
        body: `Time to take ${med.name} ${med.strength} - ${med.dose} ${med.unit}`.trim(),
        data: { medicationId: med.id, scheduledAt: ts },
        android: {
          channelId: CHANNEL_ID,
          category: AndroidCategory.ALARM,
          smallIcon: 'ic_launcher',
          pressAction: { id: 'default' },
          actions: [
            { title: 'Taken', pressAction: { id: ACTION_TAKEN } },
            { title: 'Snooze', pressAction: { id: ACTION_SNOOZE } },
          ],
        },
        ios: {
          categoryId: 'medirecord-reminder',
          sound: 'default',
        },
      },
      useAlarm
        ? { ...triggerBase, timestamp: ts, alarmManager: { type: 2 } }
        : { ...triggerBase, timestamp: ts },
    );
    scheduled += 1;
  }
}

export { EventType };
