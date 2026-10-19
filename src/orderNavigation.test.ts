import { describe, expect, it } from "vitest";
import { getRiderNavigationTarget } from "./orderNavigation";
import type { RiderOffer } from "./types/rider";

const baseOrder: RiderOffer = {
  _id: "order-1",
  assignmentState: "assigned",
  status: "ready_for_pickup",
  restaurant: { name: "Alibaba Kebab Xàtiva", address: "Calle Padre Claret 12-B" },
  customerName: "Iván Rubio Cano",
  deliveryAddress: "Carrer Sor Isabel de Villena 82, Novetlè",
};

describe("navegación del pedido activo", () => {
  it("tras confirmar retiro cambia del Partner al cliente", () => {
    expect(getRiderNavigationTarget(baseOrder)).toEqual({
      label: "GPS · Partner",
      address: "Calle Padre Claret 12-B",
      phase: "partner",
    });
    expect(getRiderNavigationTarget({ ...baseOrder, status: "picked_up" })).toEqual({
      label: "GPS · Cliente",
      address: "Carrer Sor Isabel de Villena 82, Novetlè",
      phase: "customer",
    });
  });
});
