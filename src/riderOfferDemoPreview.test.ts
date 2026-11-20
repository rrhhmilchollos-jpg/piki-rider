import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("location", { hostname: "preview.test" });
vi.mock("./components/LiveGoogleMap", () => ({ default: () => null }));
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

it("usa en la preview la misma tarjeta de asignación que recibe el rider", async () => {
  vi.useFakeTimers();
  try {
    // Se carga después de preparar location porque la app calcula sus claves de sesión al importar.
    const { default: RiderOfferDemoPreview } = await import("./components/RiderOfferDemoPreview");
    const html = renderToStaticMarkup(createElement(RiderOfferDemoPreview));
    expect(html).toContain("NUEVO PEDIDO");
    expect(html).toContain("Comercio de demostración");
    expect(html).toContain("ACEPTAR PEDIDO");
    expect(html).toContain("rider-demo-dispatch-note");
    expect(html).toContain("order.rider_offer");
    expect(html).toContain('disabled=""');
  } finally {
    vi.useRealTimers();
  }
});
