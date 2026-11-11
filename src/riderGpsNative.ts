import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";
import { watchRiderBrowserGps } from "./riderGpsBrowser";
import { riderResponseRequiresAuthentication } from "./apiAuthPolicy";
import {
  RiderGpsAuthorizationError,
  RiderGpsPermissionError,
  RiderGpsTracker,
  type GpsPort,
  type RiderGpsDiagnosticEvent,
  type RiderGpsSnapshot,
} from "./riderGpsTracker";

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

type PikiGpsDiagnosticsPlugin = {
  event: (input: { event: RiderGpsDiagnosticEvent }) => Promise<void>;
};
const PikiGpsDiagnostics = registerPlugin<PikiGpsDiagnosticsPlugin>("PikiGpsDiagnostics");

// Retain identifiers across component/session unmounts until native removal succeeds.
const nativeWatchers = new Set<string>();
let nativeRemoval: Promise<void> = Promise.resolve();

export const usesAndroidGps = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

function emitAndroidDiagnostic(event: RiderGpsDiagnosticEvent) {
  if (!usesAndroidGps()) return;
  // The native implementation emits only in Android debug builds and receives no sensitive data.
  return PikiGpsDiagnostics.event({ event }).catch(() => undefined);
}

function removeNativeWatcher(id: string): Promise<void> {
  nativeRemoval = nativeRemoval.catch(() => undefined).then(async () => {
    await BackgroundGeolocation.removeWatcher({ id });
    nativeWatchers.delete(id);
  });
  return nativeRemoval;
}

async function ensureAndroidNotificationPermission() {
  let permission = await LocalNotifications.checkPermissions();
  if (permission.display === "prompt" || permission.display === "prompt-with-rationale") {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== "granted") {
    throw new RiderGpsPermissionError("Permite las notificaciones de PIKI Riders en Ajustes para ver el servicio de GPS activo.");
  }
}

export function createRiderGpsTracker(
  apiOrigin: string,
  token: string,
  riderId: string,
  onChange: (state: RiderGpsSnapshot) => void,
  onFix: (point: { latitude: number; longitude: number; accuracy: number; heading?: number }) => void,
) {
  const browserWatchers = new Map<string, () => void>();
  let browserWatcherSequence = 0;
  const port: GpsPort = {
    async add(callbacks) {
      if (!callbacks.isCurrent()) throw new Error("Inicio de GPS cancelado.");
      if (document.visibilityState !== "visible") {
        throw new Error("Abre PIKI Riders en pantalla antes de activar el GPS.");
      }
      if (usesAndroidGps()) {
        for (const id of nativeWatchers) await removeNativeWatcher(id);
        if (!callbacks.isCurrent()) throw new Error("Inicio de GPS cancelado.");
        await ensureAndroidNotificationPermission();
        if (!callbacks.isCurrent()) throw new Error("Inicio de GPS cancelado.");
        if (document.visibilityState !== "visible") {
          throw new Error("Vuelve a PIKI Riders y pulsa Reintentar GPS con la aplicación visible.");
        }
        const id = await BackgroundGeolocation.addWatcher({
          backgroundTitle: "PIKI Riders · jornada activa",
          backgroundMessage: "Compartes tu ubicación con PIKI durante la jornada. Vuelve a Riders para finalizarla.",
          requestPermissions: true,
          stale: false,
          // The installed Android service requests high-accuracy updates every
          // 1 s; a displacement filter suppresses them while stationary.
          // Rate limiting remains in the 25 m / 60 s publication policy.
          distanceFilter: 0,
        }, (location, error) => {
          if (!callbacks.isCurrent()) return;
          if (error) {
            callbacks.onError(error.code === "NOT_AUTHORIZED"
              ? new RiderGpsPermissionError("Permite la ubicación precisa de PIKI Riders en Ajustes para repartir.")
              : new Error("No se pudo obtener la ubicación. Comprueba el GPS y vuelve a activar el seguimiento."));
          } else if (location) {
            if (location.simulated) {
              callbacks.onError(new RiderGpsPermissionError("Se recibió una ubicación simulada. Desactiva la ubicación de prueba antes de repartir."));
              return;
            }
            const nativeCourse = location.bearing;
            callbacks.onLocation({
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
              heading: typeof nativeCourse === "number" && Number.isFinite(nativeCourse) && nativeCourse >= 0 ? nativeCourse : undefined,
              // A missing native time is invalid, never replaced with Date.now().
              timestamp: location.time ?? NaN,
            });
          }
        });
        nativeWatchers.add(id);
        return id;
      }
      const id = `browser-${++browserWatcherSequence}`;
      browserWatchers.set(id, watchRiderBrowserGps(callbacks));
      return id;
    },
    async remove(id) {
      if (usesAndroidGps()) await removeNativeWatcher(id);
      else {
        browserWatchers.get(id)?.();
        browserWatchers.delete(id);
      }
    },
    async publish(point) {
      const url = `${apiOrigin}/api/v1/riders/${encodeURIComponent(riderId)}/location`;
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      // Timestamp is local evidence of a fresh provider fix, not a new API field.
      const data = { latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy, heading: point.heading };
      let status: number;
      let errorBody: unknown;
      if (usesAndroidGps()) {
        const response = await CapacitorHttp.post({ url, headers, data, connectTimeout: 15_000, readTimeout: 15_000 });
        status = response.status;
        if (status >= 400) {
          try { errorBody = typeof response.data === "string" ? JSON.parse(response.data) : response.data; }
          catch { /* An HTML proxy page is not evidence of a revoked Rider session. */ }
        }
      } else {
        const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(data), signal: AbortSignal.timeout(15_000) });
        status = response.status;
        if (status >= 400) errorBody = await response.json().catch(() => undefined);
      }
      const operationalCode = errorBody && typeof errorBody === "object"
        ? (errorBody as { error?: unknown }).error : undefined;
      if (riderResponseRequiresAuthentication(status, errorBody)
        || (status === 403 && operationalCode === "RIDER_ACCESS_DENIED")) {
        throw new RiderGpsAuthorizationError("La API rechazó la sesión. GPS detenido; revisa tu acceso antes de volver a activarlo.");
      }
      if (status < 200 || status >= 300) {
        throw new Error(`La API no confirmó la ubicación (HTTP ${status}). Se intentará con una nueva posición; no se almacena un historial offline.`);
      }
    },
    diagnose: emitAndroidDiagnostic,
  };
  return new RiderGpsTracker(port, onChange, onFix);
}
