import { useEffect } from "react";

/**
 * Emite la posición del rider mientras lleva un pedido encima.
 *
 * Solo se activa entre la recogida y la entrega: antes no tiene sentido (aún va
 * al local) y después tampoco (el pedido ya está cerrado). Envía como mucho un
 * ping cada 5 segundos y descarta los que tienen mala precisión, para no llenar
 * el mapa de saltos.
 */

type Options = {
  apiOrigin: string;
  token: string;
  publicCode: string | null;
  enabled: boolean;
  intervalMs?: number;
};

const MAX_ACCURACY_METERS = 150;

export function useRiderLocationPing({ apiOrigin, token, publicCode, enabled, intervalMs = 5000 }: Options) {
  useEffect(() => {
    if (!enabled || !publicCode || !token.trim()) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let lastSent = 0;
    let cancelled = false;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (cancelled) return;
        const now = Date.now();
        if (now - lastSent < intervalMs) return;
        if (position.coords.accuracy > MAX_ACCURACY_METERS) return;
        lastSent = now;
        void fetch(`${apiOrigin}/api/v1/orders/${encodeURIComponent(publicCode)}/location`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.trim()}` },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            headingDegrees: Number.isFinite(position.coords.heading) ? position.coords.heading : undefined,
            speedMps: Number.isFinite(position.coords.speed) ? position.coords.speed : undefined,
          }),
          keepalive: true,
        }).catch(() => {
          /* si falla la red, el siguiente ping lo reintenta */
        });
      },
      () => {
        /* sin permiso de ubicación: la rider sigue trabajando, solo no comparte posición */
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 }
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [apiOrigin, token, publicCode, enabled, intervalMs]);
}
