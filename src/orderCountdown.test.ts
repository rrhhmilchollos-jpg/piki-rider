import { describe, expect, it } from "vitest";
import { offerSecondsRemaining } from "./orderCountdown";

describe("offerSecondsRemaining", () => {
  it("counts down from the server-provided expiry time", () => {
    expect(offerSecondsRemaining("2026-10-28T12:01:00.000Z", Date.parse("2026-10-28T12:00:41.200Z"))).toBe(19);
  });

  it("returns zero after an offer deadline has passed", () => {
    expect(offerSecondsRemaining("2026-10-28T12:00:00.000Z", Date.parse("2026-10-28T12:00:01.000Z"))).toBe(0);
  });

  it("keeps the existing 60-second fallback when no valid deadline is supplied", () => {
    expect(offerSecondsRemaining(undefined, 0)).toBe(60);
    expect(offerSecondsRemaining("not-a-date", 0)).toBe(60);
  });
});
