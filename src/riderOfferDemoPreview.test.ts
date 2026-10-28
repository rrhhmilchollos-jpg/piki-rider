import { expect, it } from "vitest";
import { getRiderNavigationTarget } from "./orderNavigation";
import type { RiderOffer } from "./types/rider";

it("resuelve un destino de demostración al cliente sin convertirlo en un pedido real", () => {
  const demo: RiderOffer = {
    _id: "demo-only",
    assignmentState: "assigned",
    status: "picked_up",
    customerName: "Cliente de demostración",
    deliveryAddress: "Destino de demostración · no navegable",
  };
  expect(getRiderNavigationTarget(demo)).toEqual({
    label: "GPS · Cliente",
    address: "Destino de demostración · no navegable",
    phase: "customer",
  });
});
