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
  it("shows canonical account identity and own photo action even without GPS, preserving orders", () => {
    state.gps = { state: "error", detail: "GPS no disponible", lastAckAt: 0 };
    const employee = { id: "employee-1", name: "Nombre canónico", fullName: "María del Carmen García Fernández de la Torre", jobRole: "dispatch_coordinator", role: "support", photoUrl: null };
    const html = renderToStaticMarkup(<ActiveShiftScreen {...props()} employeeIdentity={employee} onSelectOwnPhoto={vi.fn()} onRemoveOwnPhoto={vi.fn()} />);
    expect(html).toContain(employee.fullName);
    expect(html).toContain("Puesto: dispatch_coordinator · Rol activo: support");
    expect(html).toContain("Sin foto");
    expect(html).toContain("Añadir foto propia");
    expect(html).toContain("Partner activo");
    expect(html).toContain("Partner oferta");
    expect(html).toContain("Reintentar GPS");
    expect(html).toContain("account-active-header");
    expect(html).toContain("Llamada directa al soporte");
  });
  it("removes all previous account identity when session-scoped identity is cleared", () => {
    const html = renderToStaticMarkup(<ActiveShiftScreen {...props()} employeeIdentity={null} />);
    expect(html).toContain("Nombre no disponible");
    expect(html).toContain("Puesto: No disponible · Rol activo: No disponible");
    expect(html).toContain("Sin foto");
    expect(html).not.toContain("data:image");
    expect(html).toContain("CONFIRMAR RETIRO");
  });
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
  it("does not show a new ACK as missing just because the last timer tick predates it", () => {
    const instant = 1_800_000_000_000;
    state.gps = { state: "tracking", detail: "La API ha confirmado la ubicación de este dispositivo.", lastAckAt: instant };
    const p = props();
    const clock = vi.spyOn(Date, "now").mockReturnValue(instant).mockReturnValueOnce(instant - 1);
    try {
      const html = renderToStaticMarkup(<ActiveShiftScreen {...p}/>);
      expect(html).toContain("GPS confirmado hace menos de 90 s");
      expect(html).not.toContain("GPS sin confirmación reciente");
    } finally { clock.mockRestore(); }
  });
  it("explains an expired local ACK without blaming the API or GPS provider", () => {
    state.gps = { state: "tracking", detail: "La API ha confirmado la ubicación de este dispositivo.", lastAckAt: Date.now() - 91_000 };
    const html = renderToStaticMarkup(<ActiveShiftScreen {...props()}/>);
    expect(html).toContain("La última confirmación GPS de este dispositivo ya no es reciente");
    expect(html).not.toContain("La API ha confirmado la ubicación de este dispositivo.");
    expect(html).toContain("Turno activo");
    expect(html).toContain("Partner activo");
  });
  it("keeps ACK confirmation separate from assignment eligibility without hiding existing orders", () => {
    const html = renderToStaticMarkup(<ActiveShiftScreen {...props()} currentShift={{ eligible: false }}/>);
    expect(html).toContain("GPS confirmado hace menos de 90 s");
    expect(html).toContain("La confirmación GPS no acredita por sí sola elegibilidad");
    expect(html).not.toContain("En línea");
    expect(html).toContain("Turno activo");
    expect(html).toContain("Partner activo");
  });
  it("renders HTTP and operational rejection without changing the active shift or existing cards", () => {
    state.gps = { state: "error", detail: "La API no confirmó la ubicación (HTTP 409 · RIDER_SESSION_NOT_ACTIVE).", lastAckAt: 0 };
    const html = renderToStaticMarkup(<ActiveShiftScreen {...props()}/>);
    expect(html).toContain("HTTP 409 · RIDER_SESSION_NOT_ACTIVE");
    expect(html).toContain("Turno activo");
    expect(html).toContain("Partner activo");
    expect(html).toContain("Reintentar GPS");
    expect(html).not.toContain("Fuera de turno");
  });
});
