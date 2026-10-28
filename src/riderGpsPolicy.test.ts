import { describe, expect, it } from "vitest";
import { isRiderGpsStatusBlocked, mayTrackRiderGps, validGpsPoint } from "./riderGpsPolicy";

describe("Rider GPS eligibility", () => {
  it("fails closed while the application is pending or the Rider is inactive", () => {
    expect(isRiderGpsStatusBlocked("pending")).toBe(true);
    expect(isRiderGpsStatusBlocked("pending_documents")).toBe(true);
    expect(isRiderGpsStatusBlocked("suspended")).toBe(true);
    expect(mayTrackRiderGps({ riderId: "rider-1", riderStatus: "pending", shiftActive: true })).toBe(false);
  });

  it("requires both a linked Rider and an active shift", () => {
    expect(mayTrackRiderGps({ riderId: "", riderStatus: "active", shiftActive: true })).toBe(false);
    expect(mayTrackRiderGps({ riderId: "rider-1", riderStatus: "active", shiftActive: false })).toBe(false);
    expect(mayTrackRiderGps({ riderId: "rider-1", riderStatus: "active", shiftActive: true })).toBe(true);
  });

  it("accepts only finite coordinates and API-compatible accuracy", () => {
    expect(validGpsPoint({ latitude: 38.99, longitude: -0.52, accuracy: 20 })).toBe(true);
    expect(validGpsPoint({ latitude: 91, longitude: 0, accuracy: 0 })).toBe(false);
    expect(validGpsPoint({ latitude: 0, longitude: -181, accuracy: 0 })).toBe(false);
    expect(validGpsPoint({ latitude: 0, longitude: 0, accuracy: Infinity })).toBe(false);
  });
});
