import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";
import {
  RiderGpsAuthorizationError,
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
    throw new Error("Permite las notificaciones de PIKI Riders en Ajustes para ver el servicio de GPS activo.");
  }
}

export function createRiderGpsTracker(
  apiOrigin: string,
  token: string,
  riderId: string,
  onChange: (state: RiderGpsSnapshot) => void,
  onFix: (point: { latitude: number; longitude: number; accuracy: number }) => void,
) {
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
          distanceFilter: 25,
        }, (location, error) => {
          if (error) {
            callbacks.onError(new Error(error.code === "NOT_AUTHORIZED"
              ? "Permite la ubicación precisa de PIKI Riders en Ajustes para repartir."
              : "No se pudo obtener la ubicación. Comprueba el GPS y vuelve a activar el seguimiento."));
          } else if (location) {
            callbacks.onLocation({
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
            });
          }
        });
        nativeWatchers.add(id);
        return id;
      }
      if (!navigator.geolocation) {
        throw new Error("Este navegador no ofrece ubicación. Usa HTTPS o el APK Android.");
      }
      const id = navigator.geolocation.watchPosition(
        (position) => callbacks.onLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
        (error) => callbacks.onError(new Error(error.code === 1
          ? "No has permitido la ubicación de PIKI Riders."
          : "No se pudo obtener una posición GPS. Vuelve a intentarlo.")),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
      );
      return String(id);
    },
    async remove(id) {
      if (usesAndroidGps()) await removeNativeWatcher(id);
      else navigator.geolocation.clearWatch(Number(id));
    },
    async publish(point) {
      const url = `${apiOrigin}/api/v1/riders/${encodeURIComponent(riderId)}/location`;
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const status = usesAndroidGps()
        ? (await CapacitorHttp.post({ url, headers, data: point, connectTimeout: 15_000, readTimeout: 15_000 })).status
        : (await fetch(url, { method: "POST", headers, body: JSON.stringify(point), signal: AbortSignal.timeout(15_000) })).status;
      if (status === 401 || status === 403) {
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
