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
