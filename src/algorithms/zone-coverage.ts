import type { OperationalZone } from "../integrations/piki-api";

export type ZonePath = { zone: OperationalZone; path: google.maps.LatLngLiteral[] };

/** Convierte GeoJSON [longitud, latitud] al orden de Google Maps [latitud, longitud]. */
export function toGoogleZonePaths(zones: OperationalZone[]): ZonePath[] {
  return zones.flatMap((zone) => {
    const rings = zone.polygon?.coordinates || [];
    const outer = rings[0] || [];
    if (outer.length < 3) return [];
    return [{ zone, path: outer.map(([longitude, latitude]) => ({ lat: latitude, lng: longitude })) }];
  });
}

export function zoneForPoint(point: google.maps.LatLngLiteral, zones: ZonePath[]): OperationalZone | null {
  for (const item of zones) {
    const polygon = new google.maps.Polygon({ paths: item.path });
    if (google.maps.geometry?.poly.containsLocation(new google.maps.LatLng(point), polygon)) return item.zone;
  }
  return null;
}
