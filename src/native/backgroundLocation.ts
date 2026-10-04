import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";

export type NativeLocationPoint = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type TrackingInput = {
  apiOrigin: string;
  token: string;
  riderId: string;
  onLocation?: (point: NativeLocationPoint) => void;
  onError?: (message: string) => void;
};

let activeTrackingKey = "";

export function supportsNativeBackgroundTracking() {
  return Capacitor.getPlatform() === "android";
}

/**
 * Arranca el servicio nativo Android únicamente durante una jornada activa.
 * El plugin mantiene un servicio foreground con notificación visible y publica
 * cada posición al endpoint directamente desde Android, incluso si el WebView
 * está suspendido o se cierra desde recientes.
 */
export async function startNativeBackgroundTracking(input: TrackingInput) {
  if (!supportsNativeBackgroundTracking()) return false;

  const endpoint = `${input.apiOrigin.replace(/\/$/, "")}/api/v1/riders/${encodeURIComponent(input.riderId)}/location`;
  const trackingKey = `${endpoint}:${input.token}`;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    "Content-Type": "application/json",
    "X-PIKI-Surface": "rider",
  };

  try {
    if (activeTrackingKey === trackingKey) {
      await BackgroundGeolocation.updateHeaders({ headers });
      return true;
    }

    await BackgroundGeolocation.stop().catch(() => undefined);
    const permission = await BackgroundGeolocation.checkPermissions();
    const missingPermissions = [
      permission.location !== "granted" ? "location" : null,
      permission.notification !== "granted" ? "notification" : null,
    ].filter(Boolean) as Array<"location" | "notification">;
    if (missingPermissions.length) {
      const requested = await BackgroundGeolocation.requestPermissions({ permissions: missingPermissions });
      if (requested.location !== "granted") {
        input.onError?.("Para iniciar la jornada debes permitir la ubicación precisa de PIKI.");
        return false;
      }
    }

    await BackgroundGeolocation.start(
      {
        backgroundTitle: "PIKI · jornada activa",
        backgroundMessage: "Compartiendo tu posición para coordinar pedidos y mantener a clientes informados.",
        requestPermissions: false,
        stale: false,
        distanceFilter: 12,
        minIntervalMs: 10_000,
        networkFallback: true,
        url: endpoint,
        headers,
      },
      (location, error) => {
        if (error) {
          input.onError?.("El GPS nativo necesita ubicación precisa y notificaciones activas.");
          return;
        }
        if (location) {
          input.onLocation?.({
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
          });
        }
      },
    );

    activeTrackingKey = trackingKey;
    return true;
  } catch {
    input.onError?.("No se pudo activar el GPS en segundo plano. Revisa permisos de ubicación y notificaciones.");
    return false;
  }
}

export async function stopNativeBackgroundTracking() {
  activeTrackingKey = "";
  if (!supportsNativeBackgroundTracking()) return;
  await BackgroundGeolocation.stop().catch(() => undefined);
}
