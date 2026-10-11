import type { RiderOffer } from "./types/rider";

export type RiderPaymentInstruction = {
  detail: string;
  amountToCollectCents?: number;
  amountToPayPartnerCents?: number;
};

export function isCustomerDeliveryPhase(
  status: RiderOffer["status"],
): boolean {
  return status === "picked_up" || status === "on_the_way";
}

/**
 * The rider only needs collection instructions once the customer address is
 * visible. At pickup, every order must make clear that the rider pays nothing
 * to the establishment, regardless of the customer's payment method.
 */
export function getRiderPaymentInstruction(
  order: Pick<RiderOffer, "status" | "paymentMethod" | "totalCents" | "partnerPaymentRequired" | "partnerPaymentCents">,
): RiderPaymentInstruction {
  if (!isCustomerDeliveryPhase(order.status)) {
    if (order.partnerPaymentRequired) {
      return { detail: "Paga al Partner", amountToPayPartnerCents: order.partnerPaymentCents ?? order.totalCents };
    }
    return { detail: "No tienes que pagar nada al establecimiento" };
  }

  if (order.paymentMethod === "cash") {
    return {
      detail: "Contrarreembolso · cobrar en efectivo al cliente",
      amountToCollectCents: order.totalCents,
    };
  }

  return { detail: "Pagado online" };
}
