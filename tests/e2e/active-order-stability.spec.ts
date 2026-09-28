import { test, expect } from "@playwright/test";

test("mantiene visible el pedido activo mientras actualiza ofertas", async ({ page }) => {
  let offersCalls = 0;
  const order = {
    _id: "stable-active-order",
    assignmentState: "assigned",
    status: "ready_for_pickup",
    paymentMethod: "cash",
    totalCents: 2909,
    restaurant: { name: "Restaurante estable E2E", address: "Calle Test 1" },
    items: [],
  };

  await page.route("https://api.pikidelivery.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/riders/session") return json({ rider: { id: "rider-stability-e2e", status: "active" } });
    if (path.endsWith("/slots")) return json({ slots: [] });
    if (path === "/api/v1/riders/statistics") return json({ statistics: {} });
    if (path.endsWith("/shift")) return json({ eligible: true, shift: { status: "active", zone: "E2E" } });
    if (path.endsWith("/cash-wallet")) return json({ wallet: { availableCents: 0, collectedCents: 0, handedOverCents: 0, collectedEntries: 0 } });
    if (path.endsWith("/offers")) {
      offersCalls += 1;
      if (offersCalls > 1) await new Promise((resolve) => setTimeout(resolve, 700));
      return json({ offers: [order] });
    }
    return json({});
  });

  await page.addInitScript(() => {
    sessionStorage.setItem("piki-127.0.0.1-api-token", "stability-e2e-token");
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
  });

  await page.goto("/");
  await expect(page.getByText("Restaurante estable E2E")).toBeVisible();
  await page.waitForTimeout(5200);
  await expect(page.getByText("Restaurante estable E2E")).toBeVisible();
  await expect(page.getByText("Conectando con pedidos…")).toHaveCount(0);
});
