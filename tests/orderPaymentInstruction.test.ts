import { describe, expect, it } from "vitest";
import {
  getRiderPaymentInstruction,
  isCustomerDeliveryPhase,
} from "../src/orderPaymentInstruction";

describe("rider payment instructions", () => {
  it("hides the customer's payment method while going to the establishment", () => {
    expect(
      getRiderPaymentInstruction({
        status: "ready_for_pickup",
        paymentMethod: "stripe",
        totalCents: 2909,
      }),
    ).toEqual({ detail: "No tienes que pagar en el establecimiento" });
    expect(
      getRiderPaymentInstruction({
        status: "preparing",
        paymentMethod: "cash",
        totalCents: 2909,
      }),
    ).toEqual({ detail: "No tienes que pagar en el establecimiento" });
  });

  it("shows an online-paid status only after the customer view is active", () => {
    expect(isCustomerDeliveryPhase("picked_up")).toBe(true);
    expect(
      getRiderPaymentInstruction({
        status: "picked_up",
        paymentMethod: "stripe",
        totalCents: 2909,
      }),
    ).toEqual({ detail: "Pagado online" });
  });

  it("shows the exact cash amount only at the customer address", () => {
    expect(
      getRiderPaymentInstruction({
        status: "on_the_way",
        paymentMethod: "cash",
        totalCents: 2909,
      }),
    ).toEqual({
      detail: "Contrarreembolso · cobrar en efectivo al cliente",
      amountToCollectCents: 2909,
    });
  });
});
