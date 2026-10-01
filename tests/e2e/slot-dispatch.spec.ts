import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("asigna un pedido a un Rider con slot vigente y conserva la oferta visible", async ({ page }) => {
  let offersCalls = 0;
  let slotCalls = 0;
  let assignedOrderObserved = false;
  const activeSlot = {
    _id: "slot-e2e-current",
    date: "2026-10-01",
    startTime: "00:00",
    endTime: "23:59",
    zone: "E2E",
    status: "active",
  };
  const assignedOrder = {
    _id: "order-e2e-slot-dispatch",
    assignmentState: "assigned",
    status: "ready_for_pickup",
    paymentMethod: "cash",
    totalCents: 2909,
    restaurant: { name: "Partner con slot E2E", address: "Calle Partner 1" },
    customerName: "Cliente con slot E2E",
    deliveryAddress: "Calle Cliente 2",
    items: [],
  };

  await page.route("https://api.pikidelivery.com/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (path === "/api/v1/riders/session") return json({ rider: { id: "rider-slot-e2e", status: "available" } });
    if (path.endsWith("/slots")) {
      slotCalls += 1;
      return json({ slots: [activeSlot] });
    }
    if (path === "/api/v1/riders/statistics") return json({ statistics: {} });
    if (path.endsWith("/shift")) return json({ eligible: true, selfStartAllowed: false, shift: activeSlot });
    if (path.endsWith("/cash-wallet")) return json({ wallet: { availableCents: 0, collectedCents: 0, handedOverCents: 0, collectedEntries: 0 } });
    if (path.endsWith("/offers")) {
      offersCalls += 1;
      if (offersCalls > 1) assignedOrderObserved = true;
      return json({ offers: offersCalls === 1 ? [] : [assignedOrder] });
    }
    return json({});
  });

  await page.addInitScript(() => {
    sessionStorage.setItem("piki-127.0.0.1-api-token", "slot-dispatch-e2e-token");
    localStorage.setItem("piki-127.0.0.1-api-token", "slot-dispatch-e2e-token");
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
  });
  await page.context().grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4173" });
  await page.context().setGeolocation({ latitude: 38.99, longitude: -0.52 });

  await page.goto("/");
  const permissionButton = page.getByRole("button", { name: /ubicación/ });
  if (await permissionButton.count()) await permissionButton.click();

  await expect.poll(() => assignedOrderObserved, { timeout: 15_000 }).toBe(true);
  await expect(page.getByRole("heading", { name: "Partner con slot E2E" })).toBeVisible({ timeout: 5_000 });
  expect(slotCalls).toBeGreaterThan(0);
  expect(assignedOrderObserved).toBe(true);
  await expect(page.getByText("Conectando con pedidos…")).toHaveCount(0);
});
