import { describe, expect, it } from "vitest";
import { riderPickupStatusMessage } from "./riderPickupStatus";

describe("pickup request status is independent from order progression", () => {
  it("shows pending submission without promising pickup", () => {
    expect(riderPickupStatusMessage({ orderId: "fixture", status: "sending" }, "fixture", "ready_for_pickup")).toContain("Aún no está confirmada");
  });
  it("keeps ambiguous failures pending verification", () => {
    expect(riderPickupStatusMessage({ orderId: "fixture", status: "verifying" }, "fixture", "ready_for_pickup")).toContain("pendiente de verificar");
  });
  it.each(["picked_up", "on_the_way"])("does not contradict an authoritative %s snapshot", (status) => {
    expect(riderPickupStatusMessage({ orderId: "fixture", status: "verifying" }, "fixture", status)).toBe("");
  });
  it("never inherits pending state from another order", () => {
    expect(riderPickupStatusMessage({ orderId: "old", status: "verifying" }, "new", "ready_for_pickup")).toBe("");
  });
  it("has no pending message when no submission exists", () => {
    expect(riderPickupStatusMessage(null, "fixture", "ready_for_pickup")).toBe("");
  });
});
