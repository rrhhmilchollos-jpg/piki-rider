import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptRiderOffer, RiderOfferAcceptanceError } from "./integrations/piki-api";

const acceptedOrder = {
  _id: "order-1", riderId: "rider-1", assignmentState: "assigned",
  assignmentExpiresAt: null, status: "preparing", pickupDeadlineAt: null,
};
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function validAck() {
  return { message: "Pedido aceptado. El Partner avisará cuando esté listo para retirar.", pickupDeadlineAt: null, order: acceptedOrder };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("acceptRiderOffer: published API contract", () => {
  it("posts one authenticated acceptance and validates the matching assigned order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(validAck()));
    vi.stubGlobal("fetch", fetchMock);
    const result = await acceptRiderOffer("rider-token", "rider-1", "order-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/riders/rider-1/orders/order-1/accept-offer");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ Authorization: "Bearer rider-token", "Content-Type": "application/json" });
    expect(result.message).toContain("Pedido aceptado");
    expect(result.pickupDeadlineAt).toBeNull();
  });

  it.each([
    ["empty object", {}], ["null", null], ["legacy message-only", { message: "Pedido aceptado" }],
    ["wrong order", { ...validAck(), order: { ...acceptedOrder, _id: "other-order" } }],
    ["wrong rider", { ...validAck(), order: { ...acceptedOrder, riderId: "other-rider" } }],
    ["still offered", { ...validAck(), order: { ...acceptedOrder, assignmentState: "offered" } }],
    ["terminal order", { ...validAck(), order: { ...acceptedOrder, status: "cancelled" } }],
    ["expired assignment retained", { ...validAck(), order: { ...acceptedOrder, assignmentExpiresAt: "2020-01-01T00:00:00Z" } }],
  ])("does not confirm HTTP 200 with %s", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
    await expect(acceptRiderOffer("rider-token", "rider-1", "order-1")).rejects.toMatchObject({
      name: "RiderOfferAcceptanceError", status: 200, code: "RIDER_OFFER_ACK_INVALID",
    });
  });

  it.each([200, 202, 204])("does not confirm an HTML/empty success response %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(status === 204 ? null : "<html>proxy</html>", { status })));
    await expect(acceptRiderOffer("rider-token", "rider-1", "order-1")).rejects.toMatchObject({ code: "RIDER_OFFER_ACK_INVALID", status });
  });

  it.each(["fetch", "body"])("bounds a stalled %s and never repeats the POST automatically", async (part) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => part === "fetch"
      ? new Promise<Response>(() => {})
      : Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) }));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = acceptRiderOffer("rider-token", "rider-1", "order-1").then(() => "confirmed", (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("keeps a legacy expiry rejection without claiming the working day was closed (%s)", async (withMessage) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "RIDER_OFFER_EXPIRED", ...(withMessage ? { message: "Legacy text" } : {}) }, 409)));
    await expect(acceptRiderOffer("rider-token", "rider-1", "order-1")).rejects.toMatchObject({
      name: "RiderOfferAcceptanceError", status: 409, code: "RIDER_OFFER_EXPIRED",
      message: "La oferta ha caducado. Se actualizarán tus pedidos; esto no confirma el cierre de tu jornada.",
    });
  });

  it("recognizes the current slot-aware eligibility rejection without inventing its cause", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "RIDER_OFFER_NOT_ELIGIBLE" }, 409)));
    await expect(acceptRiderOffer("rider-token", "rider-1", "order-1")).rejects.toMatchObject({
      status: 409, code: "RIDER_OFFER_NOT_ELIGIBLE",
      message: "La API no confirma que esta oferta siga siendo elegible. Se actualizarán tus pedidos; revisa tu turno, GPS y zona sin forzar disponibilidad.",
    });
  });

  it("shows a useful fallback when the offer is no longer available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "RIDER_OFFER_NOT_FOUND" }, 404)));
    const error = await acceptRiderOffer("rider-token", "rider-1", "order-1").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RiderOfferAcceptanceError);
    expect(error).toMatchObject({ status: 404, code: "RIDER_OFFER_NOT_FOUND", message: "La oferta ya no está disponible. Se actualizarán tus pedidos." });
  });

  it("does not expose arbitrary server messages/codes in the acceptance UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "secret-diagnostic", message: "arbitrary-sensitive-body" }, 503)));
    await expect(acceptRiderOffer("rider-token", "rider-1", "order-1")).rejects.toMatchObject({
      code: "RIDER_OFFER_ACCEPT_FAILED", message: "No se pudo confirmar el reparto. Se consultarán tus pedidos antes de volver a intentarlo.",
    });
  });
});
