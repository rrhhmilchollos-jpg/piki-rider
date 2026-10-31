import { describe, expect, it } from "vitest";
import { assignmentCountdownSeconds } from "./offerCountdown";

describe("assignmentCountdownSeconds", () => {
  const now = Date.parse("2026-10-31T00:00:00.000Z");

  it("returns the remaining server-authoritative seconds", () => {
    expect(assignmentCountdownSeconds("2026-10-31T00:00:12.200Z", now)).toBe(13);
  });

  it("returns zero after the offer expires", () => {
    expect(assignmentCountdownSeconds("2026-10-30T23:59:59.000Z", now)).toBe(0);
  });

  it("does not invent a countdown if the API omits or corrupts the deadline", () => {
    expect(assignmentCountdownSeconds(null, now)).toBeNull();
    expect(assignmentCountdownSeconds("not-a-date", now)).toBeNull();
  });
});
