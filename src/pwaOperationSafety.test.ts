import { describe, expect, it } from "vitest";
import { isRiderPwaOperationActive } from "./pwaOperationSafety";

describe("Rider PWA operation safety", () => {
  it("treats an active shift as an operation that must not be interrupted", () => {
    expect(isRiderPwaOperationActive({ shiftActive: true })).toBe(true);
  });

  it("retains existing protections for orders, shift controls, support, and forms", () => {
    expect(isRiderPwaOperationActive({ activeOrder: { id: "order" } })).toBe(true);
    expect(isRiderPwaOperationActive({ shiftBusy: true })).toBe(true);
    expect(isRiderPwaOperationActive({ supportFormBusy: true })).toBe(true);
    expect(isRiderPwaOperationActive({ applicationStatus: "sending" })).toBe(true);
  });

  it("allows updates when the rider is known to be idle", () => {
    expect(isRiderPwaOperationActive({ shiftActive: false })).toBe(false);
  });
});
