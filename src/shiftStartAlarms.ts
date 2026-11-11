import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { Shift } from "./types/rider";
import { prepareRiderNativeChannels } from "./riderNativeNotifications";

export const SHIFT_CHANNEL_ID = "piki_shift_start";
export const SHIFT_SOUND_NAME = "start_shift";
const ALARM_ID_PREFIX = 740_000;
const STORAGE_KEY = "piki.shiftStartAlarms.v1";
const MAX_ALARMS = 16;
let operations: Promise<unknown> = Promise.resolve();
let revision = 0;
let previousSignature = "";

function madridParts(instant: Date) {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return values;
}
/** Reject invalid dates and nonexistent/ambiguous DST hours instead of inventing a time. */
export function madridInstant(dateKey: string, hhmm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(hhmm)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const matches = [60, 120].map((offset) => new Date(local - offset * 60_000)).filter((candidate) => {
    const parts = madridParts(candidate);
    return parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute;
  });
  return matches.length === 1 ? matches[0] : null;
}
function alarmId(shift: Shift): number {
  let hash = 0;
  for (const char of `${shift.date}${shift.start}`) hash = (hash * 31 + char.charCodeAt(0)) % 90_000;
  return ALARM_ID_PREFIX + hash;
}
function isShiftAlarm(id: number) { return Number.isInteger(id) && id >= ALARM_ID_PREFIX && id < ALARM_ID_PREFIX + 90_000; }
function readScheduledIds(): number[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(isShiftAlarm) : [];
  } catch { return []; }
}
function writeScheduledIds(ids: number[]) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* Native pending IDs are the fallback. */ }
}
async function scheduledIds() {
  const pending = await LocalNotifications.getPending();
  return [...new Set([...readScheduledIds(), ...pending.notifications.map((item) => item.id).filter(isShiftAlarm)])];
}
async function cancelPrevious() {
  const ids = await scheduledIds();
  // Preserve remembered IDs if native cancellation fails, so it can be retried.
  if (ids.length) await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  writeScheduledIds([]);
  previousSignature = "";
}
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.catch(() => undefined).then(operation);
  operations = result;
  return result;
}
/** Polling never requests permission. Disabled consent and empty calendars cancel stale alarms. */
export function syncShiftStartAlarms(shifts: Shift[], options: { enabled: boolean } = { enabled: false }): Promise<number> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return Promise.resolve(0);
  const current = ++revision;
  const snapshot = shifts.map((shift) => ({ ...shift }));
  return enqueue(async () => {
    if (current !== revision) return 0;
    const upcoming = options.enabled ? snapshot
      .map((shift) => ({ shift, at: madridInstant(shift.date, shift.start) }))
      .filter((item): item is { shift: Shift; at: Date } => Boolean(item.at))
      .filter((item) => ["planned", "assigned"].includes(item.shift.status) && item.at.getTime() > Date.now() + 30_000)
      .sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_ALARMS) : [];
    const permission = await LocalNotifications.checkPermissions();
    const ids = await scheduledIds();
    const signature = JSON.stringify(upcoming.map(({ shift, at }) => [shift.date, shift.start, shift.end, shift.zone, at.getTime()]));
    if (permission.display === "granted" && upcoming.length && signature === previousSignature
      && upcoming.every(({ shift }) => ids.includes(alarmId(shift)))) return upcoming.length;
    await cancelPrevious();
    if (current !== revision || permission.display !== "granted" || !upcoming.length) return 0;
    const channels = await prepareRiderNativeChannels();
    if (!channels.shift || current !== revision) return 0;
    const exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm !== "granted") console.info("PIKI jornada: recordatorio sujeto a retrasos; alarma exacta no autorizada.");
    const usedIds = new Set<number>();
    const notifications = upcoming.map(({ shift, at }) => {
      let id = alarmId(shift);
      while (usedIds.has(id)) id = ALARM_ID_PREFIX + ((id + 1 - ALARM_ID_PREFIX) % 90_000);
      usedIds.add(id);
      return { id, title: "Hora de empezar tu jornada",
        body: `Tu turno empieza a las ${shift.start}${shift.zone ? ` en ${shift.zone}` : ""}. Abre PIKI Riders.`,
        channelId: SHIFT_CHANNEL_ID, sound: `${SHIFT_SOUND_NAME}.wav`,
        schedule: { at, allowWhileIdle: true },
        extra: { date: shift.date, start: shift.start, end: shift.end, zone: shift.zone } };
    });
    // Remember before scheduling: even a partial failure must remain cancellable.
    writeScheduledIds(notifications.map((item) => item.id));
    await LocalNotifications.schedule({ notifications });
    if (current !== revision) { await cancelPrevious(); return 0; }
    previousSignature = signature;
    return notifications.length;
  }).catch(() => { console.warn("PIKI jornada: no se pudo sincronizar el recordatorio nativo."); return 0; });
}
export function clearShiftStartAlarms(): Promise<void> {
  ++revision;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return Promise.resolve();
  return enqueue(cancelPrevious).catch(() => console.warn("PIKI jornada: cancelación pendiente de reintento."));
}
