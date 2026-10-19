import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptRiderOffer,
  RiderOfferAcceptanceError,
} from "./integrations/piki-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("acceptRiderOffer", () => {
  it("posts the authenticated acceptance to the rider-specific API route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: "Pedido aceptado. El Partner avisará cuando esté listo para retirar.",
      pickupDeadlineAt: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await acceptRiderOffer("rider-token", "rider-1", "order-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/riders/rider-1/orders/order-1/accept-offer");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({
      Authorization: "Bearer rider-token",
      "Content-Type": "application/json",
    });
    expect(result.message).toContain("Pedido aceptado");
    expect(result.pickupDeadlineAt).toBeNull();
  });

  it("converts the legacy expiry response into a reassignment state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "RIDER_OFFER_EXPIRED",
      message: "La oferta ha caducado y PIKI ya busca otro rider.",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(acceptRiderOffer("rider-token", "rider-1", "order-1"))
      .rejects.toMatchObject({
        name: "RiderOfferAcceptanceError",
        status: 409,
        code: "RIDER_OFFER_EXPIRED",
        message: "Este pedido se está reasignando. Se ha liberado tu jornada y se actualizarán tus ofertas.",
      });
  });


  it("uses the reassignment message when an old backend returns the legacy expiry code without a message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "RIDER_OFFER_EXPIRED",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));
    const error = await acceptRiderOffer("rider-token", "rider-1", "order-1")
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: "RIDER_OFFER_EXPIRED",
      message: "Este pedido se está reasignando. Se ha liberado tu jornada y se actualizarán tus ofertas.",
    });
  });

  it("shows a useful fallback when the offer is no longer available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "RIDER_OFFER_NOT_FOUND",
    }), { status: 404, headers: { "Content-Type": "application/json" } })));

    const error = await acceptRiderOffer("rider-token", "rider-1", "order-1")
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RiderOfferAcceptanceError);
    expect(error).toMatchObject({
      status: 404,
      code: "RIDER_OFFER_NOT_FOUND",
      message: "La oferta ya no está disponible. Se actualizarán tus pedidos.",
    });
  });
});
