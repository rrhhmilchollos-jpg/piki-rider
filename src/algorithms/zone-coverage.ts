import type { OperationalZone } from "../integrations/piki-api";

export type ZonePath = {
  zone: OperationalZone;
  /** Exterior ring retained for callers that consume the legacy shape. */
  path: google.maps.LatLngLiteral[];
  /** Exterior followed by any interior rings (holes), for this component. */
  paths?: google.maps.LatLngLiteral[][];
};

type GeoJsonPosition = number[];
type GeoJsonRing = GeoJsonPosition[];

function isValidCoordinate(longitude: unknown, latitude: unknown): longitude is number {
  return typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
    && typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90;
}

function convertRing(ring: GeoJsonRing): google.maps.LatLngLiteral[] | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const converted: google.maps.LatLngLiteral[] = [];
  for (const position of ring) {
    if (!Array.isArray(position) || position.length < 2 || !isValidCoordinate(position[0], position[1])) return null;
    converted.push({ lat: position[1], lng: position[0] });
  }
  if (new Set(converted.map(({ lat, lng }) => `${lat},${lng}`)).size < 3) return null;
  return converted;
}

/** Convierte GeoJSON [longitud, latitud] al orden de Google Maps [latitud, longitud]. */
export function toGoogleZonePaths(zones: OperationalZone[]): ZonePath[] {
  return zones.flatMap((zone) => {
    if (zone.isActive === false || !zone.polygon) return [];

    let components: GeoJsonRing[][];
    if (zone.polygon.type === "Polygon") {
      components = Array.isArray(zone.polygon.coordinates) ? [zone.polygon.coordinates] : [];
    } else if (zone.polygon.type === "MultiPolygon") {
      components = Array.isArray(zone.polygon.coordinates) ? zone.polygon.coordinates : [];
    } else {
      return [];
    }

    return components.flatMap((component) => {
      if (!Array.isArray(component) || component.length === 0) return [];
      const paths = component.map(convertRing);
      // Dropping a malformed inner ring could make its hole coverable, so reject the whole component.
      if (paths.some((path) => path === null)) return [];
      const validPaths = paths as google.maps.LatLngLiteral[][];
      const path = validPaths[0];
      if (!path || path.length < 3) return [];
      return [{ zone, path, paths: validPaths }];
    });
  });
}

function isValidGoogleRing(ring: google.maps.LatLngLiteral[]): boolean {
  return Array.isArray(ring)
    && ring.length >= 3
    && ring.every((point) => point !== null && typeof point === "object" && isValidCoordinate(point.lng, point.lat))
    && new Set(ring.map((point) => `${point.lat},${point.lng}`)).size >= 3;
}

export function zoneForPoint(point: google.maps.LatLngLiteral, zones: ZonePath[]): OperationalZone | null {
  if (!isValidCoordinate(point.lng, point.lat) || !google.maps.geometry?.poly?.containsLocation) return null;
  const googlePoint = new google.maps.LatLng(point);

  for (const item of zones) {
    if (item.zone.isActive === false) continue;
    const rings = item.paths?.length ? item.paths : [item.path];
    if (!rings.every(isValidGoogleRing)) continue;

    const contains = (ring: google.maps.LatLngLiteral[]) => {
      const polygon = new google.maps.Polygon({ paths: ring });
      return google.maps.geometry.poly.containsLocation(googlePoint, polygon);
    };
    const [exterior, ...holes] = rings;
    if (contains(exterior) && !holes.some(contains)) return item.zone;
  }
  return null;
}
