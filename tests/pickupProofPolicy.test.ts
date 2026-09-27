import { describe, expect, it } from "vitest";
import { normalizePickupProof } from "../src/pickupProofPolicy";

describe("pickup proof is optional", () => {
  it("allows pickup without QR or PIN", () => {
    expect(normalizePickupProof("qr", "")).toBeNull();
    expect(normalizePickupProof("pin", "   ")).toBeNull();
  });

  it("keeps a QR proof when the rider provides one", () => {
    expect(normalizePickupProof("qr", " https://pikidelivery.com/pickup/abc ")).toEqual({
      kind: "qr",
      value: "https://pikidelivery.com/pickup/abc",
    });
  });

  it("keeps a PIN proof when the rider provides one", () => {
    expect(normalizePickupProof("pin", " 4821 ")).toEqual({ kind: "pin", value: "4821" });
  });
});
