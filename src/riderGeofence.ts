import { useEffect, useState } from "react";

export type GeofenceGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type DeliveryZone = {
  geometry: GeofenceGeometry | null;
  zoneNames: string[];
  zoneSlug: string | null;
  city: string | null;
  strikeLimit: number;
  graceMinutes: number;
};

export function ringsOf(geometry: GeofenceGeometry): number[][][] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

export function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const yi = ring[i][1];
    const xi = ring[i][0];
    const yj = ring[j][1];
    const xj = ring[j][0];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(lat: number, lng: number, geometry: GeofenceGeometry | null): boolean {
  if (!geometry) return true;
  return ringsOf(geometry).some((ring) => (ring.length > 2 ? pointInRing(lat, lng, ring) : false));
}

/** Zona de reparto del rider; se cachea por rider para no pedirla en cada render. */
export function useDeliveryZone(apiOrigin: string, token: string, riderId: string): DeliveryZone | null {
  const [zone, setZone] = useState<DeliveryZone | null>(null);
  useEffect(() => {
    if (!token || !riderId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/delivery-zone`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return;
        const payload = (await response.json()) as DeliveryZone;
        if (!cancelled) setZone(payload);
      } catch {
        /* sin geocerca no se bloquea nada */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiOrigin, token, riderId]);
  return zone;
}
