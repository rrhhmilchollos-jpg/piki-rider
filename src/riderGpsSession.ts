export const RIDER_GPS_STOP_EVENT = "piki-rider-tracking-stop";
export const RIDER_GPS_START_EVENT = "piki-rider-tracking-start";

/** Dispatch synchronously so native callbacks are invalidated before React/session mutation. */
export function stopRiderDeviceGps() {
  window.dispatchEvent(new Event(RIDER_GPS_STOP_EVENT));
}

/** Requests a safe retry from the current tracker without creating a second watcher. */
export function startRiderDeviceGps() {
  window.dispatchEvent(new Event(RIDER_GPS_START_EVENT));
}
