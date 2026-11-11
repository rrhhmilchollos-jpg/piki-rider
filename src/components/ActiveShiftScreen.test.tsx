import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import ActiveShiftScreen from "./ActiveShiftScreen";

const state = vi.hoisted(() => ({ gps: { state: "tracking", detail: "GPS OK", lastAckAt: Date.now() } }));
vi.mock("./LiveGoogleMap", () => ({ default: () => <div>Mapa simulado</div> }));
vi.mock("./CodPaymentActions", () => ({ default: () => null }));
vi.mock("../authStorage", () => ({ getStoredToken: () => "fake-test-token" }));
vi.mock("../riderGpsState", () => ({ useRiderGpsSnapshot: () => state.gps }));

function props(): ComponentProps<typeof ActiveShiftScreen> {
  return {
    shiftActive: true, riderOperationalStatus: "busy", currentShift: { eligible: true },
    offers: [
      { _id: "active-id", publicCode: "ACTIVE123", assignmentState: "assigned", status: "ready_for_pickup", restaurant: { name: "Partner activo" } },
      { _id: "pending-id", publicCode: "OFFER123", assignmentState: "offered", status: "preparing", restaurant: { name: "Partner oferta" }, assignmentExpiresAt: new Date(Date.now() + 60_000).toISOString() },
    ],
    offersError: "", offersLoading: false, startedShiftNotice: false, toast: "", tipNotification: "",
    onDismissStartNotice: vi.fn(), onOpenOperations: vi.fn(), onCallSupport: vi.fn(), onOpenSupport: vi.fn(),
    onOpenOrderChat: vi.fn(), onRefreshOffers: vi.fn(), onAcceptOffer: vi.fn(), onOfferAction: vi.fn(),
    onConfirmPickup: vi.fn(), onConfirmDelivery: vi.fn(), onError: vi.fn(),
  };
}
beforeEach(() => { state.gps = { state: "tracking", detail: "GPS OK", lastAckAt: Date.now() }; });
afterEach(() => vi.unstubAllGlobals());

describe("active shift server rendering (no device/network)", () => {
  it("renders offered and assigned independently, with accept and pickup actions", () => {
    const html = renderToStaticMarkup(<ActiveShiftScreen {...props()}/>);
    expect(html).toContain("Ofertas pendientes de respuesta");
    expect(html).toContain("Partner oferta");
    expect(html).toContain("Partner activo");
    expect(html).toContain("ACEPTAR PEDIDO");
    expect(html).toContain("CONFIRMAR RETIRO");
    expect(html).not.toContain("is-collapsed");
  });
  it("does not hide either card after a failed sync and disables stale confirmation actions", () => {
    const html = renderToStaticMarkup(<ActiveShiftScreen {...props()} offersError="offline"/>);
    expect(html).toContain("Partner oferta");
    expect(html).toContain("Partner activo");
    expect(html).toContain("Reintentar pedidos");
    expect(html).toMatch(/disabled=""[^>]*>ACEPTAR PEDIDO/);
    expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?CONFIRMAR RETIRO/);
    expect(html).not.toContain("Buscando pedidos");
  });
  it("shows a stale ACK as attention needed, not online, and exposes GPS restart", () => {
    state.gps.lastAckAt = Date.now() - 91_000;
    const html = renderToStaticMarkup(<ActiveShiftScreen {...props()}/>);
    expect(html).toContain("Revisar GPS");
    expect(html).toContain("Reintentar GPS");
    expect(html).not.toContain("En línea");
  });
  it("never allows acceptance of an expired persisted offer", () => {
    const p = props();
    p.offers[1].assignmentExpiresAt = new Date(Date.now() - 1).toISOString();
    const html = renderToStaticMarkup(<ActiveShiftScreen {...p}/>);
    expect(html).toContain("Oferta caducada");
    expect(html).toMatch(/disabled=""[^>]*>ACEPTAR PEDIDO/);
  });
  it("does not inherit a persisted collapsed sheet even when only an assigned order exists", () => {
    const getItem = vi.fn(() => "true");
    vi.stubGlobal("localStorage", { getItem });
    const p = props();
    p.offers = p.offers.filter((offer) => offer.assignmentState === "assigned");
    const html = renderToStaticMarkup(<ActiveShiftScreen {...p}/>);
    expect(html).not.toContain("is-collapsed");
    expect(html).toContain("CONFIRMAR RETIRO");
    expect(getItem).not.toHaveBeenCalled();
  });
});
