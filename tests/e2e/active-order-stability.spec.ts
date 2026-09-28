import { test, expect } from "@playwright/test";

test("mantiene visible el pedido activo mientras actualiza ofertas", async ({ page }) => {
  let offersCalls = 0;
  let sessionCalls = 0;
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
    if (path === "/api/v1/riders/session") {
      sessionCalls += 1;
      return json({ rider: { id: "rider-stability-e2e", status: "active" } });
    }
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
    localStorage.setItem("piki-127.0.0.1-api-token", "stability-e2e-token");
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
  });

  await page.context().grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4173" });
  await page.context().setGeolocation({ latitude: 38.99, longitude: -0.52 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Restaurante estable E2E" })).toBeVisible();
  await expect(page.locator(".active-order-detail").getByText("Calle Test 1")).toBeVisible();
  await page.waitForTimeout(150);
  const sessionsBeforeResume = sessionCalls;
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect.poll(() => sessionCalls).toBeGreaterThan(sessionsBeforeResume);

  const handle = page.getByRole("button", { name: "Minimizar ficha del pedido" });
  await handle.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", button: 0, clientY: 150, bubbles: true });
  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, pointerType: "touch", clientY: 240, bubbles: true })));
  await expect(page.getByRole("button", { name: "Ampliar ficha del pedido" })).toBeVisible();
  await expect(page.locator(".active-order-summary")).toContainText("Restaurante estable E2E");
  await expect(page.locator(".active-order-detail")).toBeHidden();

  const compactHandle = page.getByRole("button", { name: "Ampliar ficha del pedido" });
  await compactHandle.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", button: 0, clientY: 240, bubbles: true });
  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, pointerType: "touch", clientY: 150, bubbles: true })));
  await expect(page.locator(".active-order-detail")).toBeVisible();

  await page.waitForTimeout(5200);
  await expect(page.getByRole("heading", { name: "Restaurante estable E2E" })).toBeVisible();
  await expect(page.getByText("Conectando con pedidos…")).toHaveCount(0);

  await page.getByRole("button", { name: "Minimizar ficha del pedido" }).click();
  await page.reload();
  await expect(page.locator(".active-order-summary")).toContainText("Restaurante estable E2E");
  await expect(page.locator(".active-order-summary")).toContainText("Calle Test 1");
  await expect(page.locator(".active-order-detail")).toBeHidden();
  await expect(page.getByText("Iniciar sesión")).toHaveCount(0);
});
