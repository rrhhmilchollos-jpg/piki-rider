/**
 * Aviso sonoro de inicio de jornada en la app nativa.
 *
 * El backend ya emite `rider.shift_start_reminder` por push, pero un push solo
 * suena si llega en el momento y el sistema lo permite. Aquí el propio teléfono
 * programa la alarma a partir del calendario asignado por Fleet, con el canal
 * Android `piki_shift_start` y el recurso `res/raw/start_shift.wav`, de modo que
 * suena aunque la app esté cerrada y sin depender de FCM.
 */

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { Shift } from "./types/rider";

export const SHIFT_CHANNEL_ID = "piki_shift_start";
export const SHIFT_SOUND_NAME = "start_shift";
const ALARM_ID_PREFIX = 740_000;
const STORAGE_KEY = "piki.shiftStartAlarms.v1";
const MAX_ALARMS = 16;

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Partes de fecha/hora en Europe/Madrid para un instante dado. */
function madridParts(instant: Date) {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return { year: values.year, month: values.month, day: values.day, hour: values.hour === 24 ? 0 : values.hour, minute: values.minute };
}

/** Desfase de Madrid (en ms) para un día concreto, calculado a mediodía. */
function madridOffsetMs(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  const parts = madridParts(new Date(utcNoon));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - utcNoon;
}

/** Instante UTC que corresponde a una hora local de Madrid. */
export function madridInstant(dateKey: string, hhmm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(hhmm)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(asUtc - madridOffsetMs(dateKey));
}

function alarmId(shift: Shift): number {
  let hash = 0;
  for (const char of `${shift.date}${shift.start}`) hash = (hash * 31 + char.charCodeAt(0)) % 90_000;
  return ALARM_ID_PREFIX + hash;
}

function readScheduledIds(): number[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value) => Number.isInteger(value)) : [];
  } catch {
    return [];
  }
}

function writeScheduledIds(ids: number[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* el aviso sigue programado aunque no se pueda recordar el id */
  }
}

/** Crea el canal Android con el sonido propio. El canal es inmutable una vez creado. */
async function ensureShiftChannel(): Promise<boolean> {
  try {
    await LocalNotifications.createChannel({
      id: SHIFT_CHANNEL_ID,
      name: "Inicio de jornada",
      description: "Aviso sonoro cuando empieza un turno asignado por Fleet.",
      sound: SHIFT_SOUND_NAME,
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function ensurePermission(): Promise<boolean> {
  const current = await LocalNotifications.checkPermissions();
  if (current.display === "granted") return true;
  const requested = await LocalNotifications.requestPermissions();
  return requested.display === "granted";
}

/**
 * Sincroniza las alarmas con el calendario del Rider: cancela las anteriores y
 * programa las próximas. Devuelve cuántas quedaron activas.
 */
export async function syncShiftStartAlarms(shifts: Shift[]): Promise<number> {
  if (!isNative() || !shifts.length) return 0;
  if (!(await ensurePermission())) return 0;
  if (!(await ensureShiftChannel())) return 0;

  const previous = readScheduledIds();
  if (previous.length) {
    await LocalNotifications.cancel({ notifications: previous.map((id) => ({ id })) }).catch(() => undefined);
  }

  const now = Date.now();
  const upcoming = shifts
    .map((shift) => ({ shift, at: madridInstant(shift.date, shift.start) }))
    .filter((item): item is { shift: Shift; at: Date } => Boolean(item.at))
    .filter((item) => ["planned", "assigned", "active"].includes(item.shift.status))
    .filter((item) => item.at.getTime() > now + 30_000)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_ALARMS);

  if (!upcoming.length) {
    writeScheduledIds([]);
    return 0;
  }

  const notifications = upcoming.map(({ shift, at }) => ({
    id: alarmId(shift),
    title: "Hora de empezar tu jornada",
    body: `Tu turno empieza a las ${shift.start}${shift.zone ? ` en ${shift.zone}` : ""}. Abre PIKI Riders e inicia sesión.`,
    channelId: SHIFT_CHANNEL_ID,
    sound: SHIFT_SOUND_NAME,
    schedule: { at, allowWhileIdle: true },
    extra: { date: shift.date, start: shift.start, end: shift.end, zone: shift.zone },
  }));

  try {
    await LocalNotifications.schedule({ notifications });
    const ids = notifications.map((item) => item.id);
    writeScheduledIds(ids);
    return ids.length;
  } catch {
    writeScheduledIds([]);
    return 0;
  }
}

/** Cancela todas las alarmas de jornada (por ejemplo al cerrar sesión). */
export async function clearShiftStartAlarms(): Promise<void> {
  if (!isNative()) return;
  const previous = readScheduledIds();
  if (previous.length) await LocalNotifications.cancel({ notifications: previous.map((id) => ({ id })) }).catch(() => undefined);
  writeScheduledIds([]);
}
