import { Capacitor } from "@capacitor/core";
import type { Location } from "@capacitor-community/background-geolocation";
import { BackgroundGeolocation } from "./riderBackgroundGeolocation";
import { validGpsPoint, type GpsFix } from "./riderGpsPolicy";
import { RIDER_GPS_STOP_EVENT } from "./riderGpsSession";

function validFreshFix(fix: GpsFix, since: number) {
  return validGpsPoint(fix) && Number.isFinite(fix.timestamp) && fix.timestamp >= since && fix.timestamp <= Date.now();
}
/** Foreground-only one-shot watcher, always removed; never uses last-known/simulated GPS. */
export function captureRiderGps(timeoutMs = 15_000): Promise<GpsFix> {
  if (typeof document === "undefined" || document.visibilityState !== "visible") {
    return Promise.reject(new Error("Abre PIKI Riders para compartir una posición GPS real."));
  }
  const since = Date.now();
  return new Promise<GpsFix>((resolve, reject) => {
    let settled = false;
    let nativeId: string | undefined;
    let browserId: number | undefined;
    const remove = () => {
      if (nativeId) {
        const id = nativeId; nativeId = undefined;
        void BackgroundGeolocation.removeWatcher({ id }).catch(() => console.warn("PIKI GPS: captura pendiente de retirar."));
      }
      if (browserId !== undefined) { navigator.geolocation.clearWatch(browserId); browserId = undefined; }
    };
    const complete = (fix?: GpsFix, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener(RIDER_GPS_STOP_EVENT, cancelled);
      remove();
      if (fix) resolve(fix); else reject(error ?? new Error("No se recibió una posición GPS real."));
    };
    const cancelled = () => complete(undefined, new Error("Captura GPS cancelada."));
    const timer = setTimeout(() => complete(undefined, new Error("No se obtuvo un GPS preciso a tiempo.")), timeoutMs);
    window.addEventListener(RIDER_GPS_STOP_EVENT, cancelled);
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      void BackgroundGeolocation.addWatcher({ requestPermissions: true, stale: false, distanceFilter: 0 }, (location?: Location, error?: Error) => {
        if (settled) return;
        if (error) { complete(undefined, new Error("Permite la ubicación precisa y activa el GPS en Android.")); return; }
        if (!location) return;
        if (location.simulated) { complete(undefined, new Error("La ubicación simulada no puede validar una operación.")); return; }
        const fix: GpsFix = { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy,
          heading: typeof location.bearing === "number" && location.bearing >= 0 && location.bearing <= 360 ? location.bearing : undefined,
          timestamp: location.time ?? NaN };
        if (validFreshFix(fix, since)) complete(fix);
      }).then((id) => { nativeId = id; if (settled) remove(); })
        .catch(() => complete(undefined, new Error("GPS nativo no disponible. Revisa permisos y vuelve a intentarlo.")));
    } else if (typeof navigator !== "undefined" && navigator.geolocation) {
      try {
        browserId = navigator.geolocation.watchPosition((position) => {
          const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude,
            accuracy: position.coords.accuracy, timestamp: position.timestamp };
          if (validFreshFix(fix, since)) complete(fix);
        }, () => complete(undefined, new Error("Permite la ubicación precisa y vuelve a intentarlo.")),
        { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs });
        if (settled) remove();
      } catch { complete(undefined, new Error("Este dispositivo no permite obtener GPS.")); }
    } else complete(undefined, new Error("Este dispositivo no ofrece GPS."));
  });
}
