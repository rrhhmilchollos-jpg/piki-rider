import { describe, expect, it } from "vitest";
import { normalizeRiderShift, parseRiderShiftSnapshot, riderSnapshotHasActiveShift, RiderShiftSync } from "./riderShiftSync";

const assigned = { date: "2026-11-11", startTime: "12:00", endTime: "00:00", status: "assigned", zoneSlug: "xativa" };

describe("Rider shift snapshot contract", () => {
  it("preserves Fleet's 24-hour midnight end without interpreting it as noon or UTC", () => {
    expect(normalizeRiderShift(assigned)).toMatchObject({ date: "2026-11-11", start: "12:00", end: "00:00" });
    expect(parseRiderShiftSnapshot({ eligible: false, shift: { ...assigned, status: "active" } })?.shift?.status).toBe("active");
  });

  it("requires a current active slot, not a future informational active slot", () => {
    const current = parseRiderShiftSnapshot({ eligible: true, shift: { ...assigned, status: "active" } })!;
    const future = parseRiderShiftSnapshot({ eligible: false, shift: { ...assigned, status: "active" } })!;
    expect(riderSnapshotHasActiveShift(current)).toBe(true);
    expect(riderSnapshotHasActiveShift(future)).toBe(false);
  });

  it.each([null, {}, { eligible: false }, { shift: null }, { eligible: "false", shift: null }, { eligible: false, shift: {} }, { eligible: false, shift: { status: "unknown" } }])("rejects an incomplete response instead of declaring a closed shift: %j", (body) => {
    expect(parseRiderShiftSnapshot(body)).toBeNull();
  });

  it("still accepts confirmed closures, cancellations and no assigned shift", () => {
    expect(parseRiderShiftSnapshot({ eligible: false, shift: { ...assigned, status: "completed" } })?.shift?.status).toBe("completed");
    expect(parseRiderShiftSnapshot({ eligible: false, shift: { ...assigned, status: "cancelled" } })?.shift?.status).toBe("cancelled");
    expect(parseRiderShiftSnapshot({ eligible: false, shift: null })).toMatchObject({ eligible: false, shift: null });
  });
});

describe("Rider start / polling ordering", () => {
  it("rejects a GET begun before a successful POST start", () => {
    const sync = new RiderShiftSync();
    const oldRead = sync.beginRead();
    sync.beginStart();
    sync.finishStart();
    expect(sync.mayApply(oldRead)).toBe(false);
    expect(sync.mayApply(sync.beginRead())).toBe(true);
  });

  it("does not let repeated assigned snapshots interrupt slow permissions or GPS capture", () => {
    const sync = new RiderShiftSync();
    sync.beginStart();
    const duringPermissions = sync.beginRead();
    expect(sync.mayApply(duringPermissions)).toBe(false);
    expect(sync.mayApply(sync.beginRead())).toBe(false);
    sync.finishStart();
    expect(sync.mayApply(duringPermissions)).toBe(false);
  });

  it("rejects a JSON body that arrives after the user logs out or changes identity", async () => {
    const sync = new RiderShiftSync();
    const read = sync.beginRead();
    const response = Promise.resolve({ eligible: false, shift: assigned });
    sync.reset();
    await response;
    expect(sync.mayApply(read)).toBe(false);
  });

  it("allows a fresh authoritative closure after start has settled", () => {
    const sync = new RiderShiftSync();
    sync.beginStart();
    sync.finishStart();
    const afterStart = sync.beginRead();
    expect(sync.mayApply(afterStart)).toBe(true);
    expect(parseRiderShiftSnapshot({ eligible: false, shift: { ...assigned, status: "completed" } })).not.toBeNull();
  });

  it("releases the start barrier after failure so the next read can recover", () => {
    const sync = new RiderShiftSync();
    sync.beginStart();
    sync.finishStart();
    expect(sync.mayApply(sync.beginRead())).toBe(true);
  });
});
