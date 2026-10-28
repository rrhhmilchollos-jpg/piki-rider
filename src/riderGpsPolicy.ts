export type GpsPoint = { latitude: number; longitude: number; accuracy: number };

const blockedRiderStatuses = new Set([
  "pending",
  "pending_documents",
  "suspended",
  "terminated",
  "revoked",
  "baja",
  "deleted",
  "inactive",
]);

/** Native background tracking already filters at 25 m; browsers use this too before publishing. */
export const riderGpsMinimumPublishDistanceMeters = 25;
/** Keep a bounded proof-of-life while stationary without producing a dense location trail. */
export const riderGpsStationaryHeartbeatMs = 60_000;

export function isRiderGpsStatusBlocked(status?: string | null) {
  return blockedRiderStatuses.has((status ?? "").trim().toLowerCase());
}

/** GPS never starts for an unlinked, pending, or inactive Rider account. */
export function mayTrackRiderGps(input: {
  riderId: string;
  riderStatus?: string | null;
  shiftActive: boolean;
}) {
  return Boolean(input.riderId.trim())
    && input.shiftActive
    && !isRiderGpsStatusBlocked(input.riderStatus);
}

export function validGpsPoint(point: GpsPoint): boolean {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
    && Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= 500;
}

export function gpsDistanceMeters(a: GpsPoint, b: GpsPoint): number {
  const radians = Math.PI / 180;
  const latDelta = (b.latitude - a.latitude) * radians;
  const lngDelta = (b.longitude - a.longitude) * radians;
  const latA = a.latitude * radians;
  const latB = b.latitude * radians;
  const haversine = Math.sin(latDelta / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin(lngDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

/** Sends immediately after a meaningful move, otherwise at a bounded heartbeat cadence. */
export function shouldPublishRiderGpsFix(
  point: GpsPoint,
  lastPublishedPoint: GpsPoint | null,
  lastPublishedAt: number,
  now = Date.now(),
): boolean {
  if (!lastPublishedPoint || !lastPublishedAt) return true;
  if (now - lastPublishedAt >= riderGpsStationaryHeartbeatMs) return true;
  return gpsDistanceMeters(lastPublishedPoint, point) >= riderGpsMinimumPublishDistanceMeters;
}
