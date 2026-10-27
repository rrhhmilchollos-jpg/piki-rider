import { describe, expect, it } from "vitest";
import { deliveryProofPayload, normalizeDeliveryProof } from "./deliveryProof";

describe("delivery proof alternatives", () => {
  it("normalizes a Customer PIN without requiring a QR", () => {
    expect(deliveryProofPayload(" a5ab39 ")).toEqual({ deliveryQr: "A5AB39" });
  });

  it("keeps a signed QR URL case-sensitive and does not require a PIN", () => {
    const qr = "https://pikidelivery.com/?order_id=abc&delivery_token=AbCxyz_9";
    expect(deliveryProofPayload(qr)).toEqual({ deliveryQr: qr });
  });

  it("sends exactly one credential field for both methods", () => {
    for (const proof of ["123456", "https://pikidelivery.com/?delivery_token=AbC"])
      expect(Object.keys(deliveryProofPayload(proof))).toEqual(["deliveryQr"]);
  });

  it("trims outer whitespace without modifying opaque QR tokens", () => {
    expect(normalizeDeliveryProof("  qrToken-AbC_19  ")).toBe("qrToken-AbC_19");
    expect(normalizeDeliveryProof("   ")).toBe("");
  });
});
