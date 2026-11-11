import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export const RIDER_NATIVE_CHANNELS = {
  shift: { id: "piki_shift_start", sound: "start_shift.wav" },
  order: { id: "piki_new_order_rider", sound: "new_order_rider.wav" },
  cancelled: { id: "piki_order_cancelled", sound: "order_cancelled.wav" },
} as const;
type Kind = keyof typeof RIDER_NATIVE_CHANNELS;
const DeviceNotifications = registerPlugin<{
  prepareChannels(): Promise<Record<Kind, boolean>>;
  show(input: { kind: Kind; id: number; consent: boolean; expiresAt: number }): Promise<{ scheduled: boolean }>;
  retainOrders(input: { ids: number[] }): Promise<void>;
  clearAlerts(): Promise<void>;
}>("PikiRiderNotifications");
export const usesAndroidNotifications = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
let operations: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.catch(() => undefined).then(operation);
  operations = result;
  return result;
}
function alertId(key: string) {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) % 90_000;
  return 830_000 + hash;
}
export async function prepareRiderNativeChannels() {
  if (!usesAndroidNotifications()) return { shift: false, order: false, cancelled: false };
  return DeviceNotifications.prepareChannels();
}
/** Called only by explicit consent actions, never by calendar polling/login. */
export async function requestRiderNotificationPermission(): Promise<boolean> {
  if (!usesAndroidNotifications()) return false;
  let permission = await LocalNotifications.checkPermissions();
  if (permission.display === "prompt" || permission.display === "prompt-with-rationale") {
    permission = await LocalNotifications.requestPermissions();
  }
  return permission.display === "granted";
}
/** A queued notification is not proof that the OS played its sound. */
export function queueRiderNativeAlert(kind: Kind, consent: boolean, key: string = kind, expiry?: string | null): boolean {
  if (!usesAndroidNotifications() || !consent) return false;
  const requestedExpiry = expiry ? Date.parse(expiry) : Date.now() + 15_000;
  if (!Number.isFinite(requestedExpiry) || requestedExpiry <= Date.now()) return false;
  const expiresAt = Math.min(requestedExpiry, Date.now() + 15_000);
  void enqueue(async () => {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted" || expiresAt <= Date.now()) return false;
    return (await DeviceNotifications.show({ kind, id: alertId(key), consent, expiresAt })).scheduled;
  }).catch(() => console.warn("PIKI avisos: notificación nativa no disponible."));
  return true;
}
/** Snapshot/consent/session cancellation shares the show queue, preventing a late orphan. */
export function retainRiderNativeOrderAlerts(keys: string[]): Promise<void> {
  if (!usesAndroidNotifications()) return Promise.resolve();
  return enqueue(() => DeviceNotifications.retainOrders({ ids: keys.map(alertId) }))
    .catch(() => console.warn("PIKI avisos: no se pudo cancelar el aviso nativo."));
}

export function clearRiderNativeAlerts(): Promise<void> {
  if (!usesAndroidNotifications()) return Promise.resolve();
  return enqueue(() => DeviceNotifications.clearAlerts())
    .catch(() => console.warn("PIKI avisos: cancelación nativa pendiente."));
}
