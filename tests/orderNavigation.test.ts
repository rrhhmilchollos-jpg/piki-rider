import { describe, expect, it } from "vitest";
import { buildDirectionsUrl, getRiderNavigationTarget } from "../src/orderNavigation";

const baseOrder = {
  _id: "order-navigation",
  assignmentState: "assigned" as const,
  status: "ready_for_pickup" as const,
  restaurant: { name: "Partner Demo", address: "Calle Partner 10" },
  customerName: "Cliente Demo",
  deliveryAddress: "Calle Cliente 20",
};

describe("rider navigation target", () => {
  it("points to the partner before pickup", () => {
    expect(getRiderNavigationTarget(baseOrder)).toMatchObject({
      label: "GPS · Partner",
      address: "Calle Partner 10",
      phase: "partner",
    });
  });

  it("points to the customer after pickup", () => {
    expect(getRiderNavigationTarget({ ...baseOrder, status: "picked_up" })).toMatchObject({
      label: "GPS · Cliente",
      address: "Calle Cliente 20",
      phase: "customer",
    });
  });

  it("encodes the destination in a Google Maps directions URL", () => {
    expect(buildDirectionsUrl("Calle Cliente 20, Xàtiva")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Calle%20Cliente%2020%2C%20X%C3%A0tiva",
    );
  });
});
