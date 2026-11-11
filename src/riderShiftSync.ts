import { normalizeScheduleDate } from "./scheduleCalendar";
import type { CurrentShift, Shift } from "./types/rider";

const shiftStatuses = new Set<Shift["status"]>(["assigned", "pending", "planned", "active", "completed", "cancelled"]);

export function normalizeRiderShift(raw: Record<string, unknown>): Shift {
  const rawDay = String(raw.day || "");
  return {
    day: rawDay ? `${rawDay.slice(0, 1).toUpperCase()}${rawDay.slice(1)}` : "",
    date: normalizeScheduleDate(String(raw.date || "")),
    start: String(raw.start || raw.startTime || ""),
    end: String(raw.end || raw.endTime || ""),
    zone: String(raw.zone || raw.zoneSlug || ""),
    status: String(raw.status || "planned") as Shift["status"],
  };
}

/** Missing fields are a synchronization failure, not evidence that a shift ended. */
export function parseRiderShiftSnapshot(body: unknown): CurrentShift | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (typeof value.eligible !== "boolean" || !("shift" in value)) return null;
  if (value.shift !== null) {
    if (!value.shift || typeof value.shift !== "object") return null;
    const status = (value.shift as Record<string, unknown>).status;
    if (!shiftStatuses.has(status as Shift["status"])) return null;
  }
  return {
    ...value,
    eligible: value.eligible,
    shift: value.shift === null ? null : normalizeRiderShift(value.shift as Record<string, unknown>),
  };
}

/** The legacy API may expose a future slot in `shift`; eligible proves it is current. */
export function riderSnapshotHasActiveShift(snapshot: CurrentShift): boolean {
  return snapshot.eligible && snapshot.shift?.status === "active";
}

/** A read begun before start/logout must never overwrite the new confirmed state. */
export class RiderShiftSync {
  private revision = 0;
  private starting = false;

  beginRead(): number { return this.revision; }

  mayApply(readRevision: number): boolean {
    return !this.starting && readRevision === this.revision;
  }

  beginStart(): void {
    this.starting = true;
    this.revision += 1;
  }

  finishStart(): void {
    this.starting = false;
    this.revision += 1;
  }

  reset(): void {
    this.starting = false;
    this.revision += 1;
  }
}
