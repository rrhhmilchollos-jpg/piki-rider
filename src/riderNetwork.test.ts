import { describe, expect, it, vi } from "vitest";
import { isRiderPwaOperationActive } from "./pwaOperationSafety";
import { createRiderFetch, RIDER_NETWORK_ERROR_MESSAGE } from "./riderNetwork";

describe("Rider network resilience during an active delivery", () => {
  it("recovers a safe read after a simulated connection loss", async () => {
    const nativeFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ orders: [] }), { status: 200 }));
    const fetcher = createRiderFetch(nativeFetch, { retries: 2, retryDelayMs: 0 });

    const response = await fetcher("https://api.pikidelivery.com/api/v1/riders/rider-1/offers");

    expect(response.ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(isRiderPwaOperationActive({ activeOrder: { _id: "order-1", status: "on_the_way" } })).toBe(true);
  });

  it("does not replay a delivery mutation after a lost connection", async () => {
    const nativeFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const fetcher = createRiderFetch(nativeFetch, { retries: 2, retryDelayMs: 0 });

    await expect(fetcher("https://api.pikidelivery.com/api/v1/riders/rider-1/orders/order-1/confirm-delivery", { method: "POST" }))
      .rejects.toMatchObject({ name: "RiderNetworkError", message: RIDER_NETWORK_ERROR_MESSAGE });
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });
});
