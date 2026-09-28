import type { RiderOffer } from "./types/rider";
import { isCustomerDeliveryPhase } from "./orderPaymentInstruction";

export type RiderNavigationTarget = {
  label: "GPS · Partner" | "GPS · Cliente";
  address: string;
  phase: "partner" | "customer";
};

export function getRiderNavigationTarget(order: RiderOffer): RiderNavigationTarget {
  const customerPhase = isCustomerDeliveryPhase(order.status);
  if (customerPhase) {
    return {
      label: "GPS · Cliente",
      address: order.deliveryAddress || order.customerName || "Dirección del cliente",
      phase: "customer",
    };
  }
  return {
    label: "GPS · Partner",
    address: order.restaurant?.address || order.restaurant?.name || "Establecimiento Partner",
    phase: "partner",
  };
}

export function buildDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
