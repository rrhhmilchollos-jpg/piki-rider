import { test, expect } from "@playwright/test";

const orderId = "order-e2e-pickup";

async function mockRiderApi(page: import("@playwright/test").Page) {
  let orderStatus = "ready_for_pickup";
  let lastTransition: Record<string, unknown> | null = null;

  await page.route("https://api.pikidelivery.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/v1/riders/session") return json({ rider: { id: "rider-e2e", status: "active" } });
    if (path.endsWith("/slots")) return json({ slots: [] });
    if (path === "/api/v1/riders/statistics") return json({ statistics: {} });
    if (path.endsWith("/shift")) return json({ eligible: true, shift: { status: "active", zone: "E2E" } });
    if (path.endsWith("/cash-wallet")) return json({ wallet: { availableCents: 0, collectedCents: 0, handedOverCents: 0, collectedEntries: 0 } });
    if (path.endsWith("/offers")) return json({ offers: [{ _id: orderId, assignmentState: "assigned", status: orderStatus, restaurant: { name: "Restaurante E2E", address: "Calle Test 1" }, customerName: "Cliente E2E", deliveryAddress: "Calle Cliente 2", items: [] }] });
    if (path.endsWith(`/orders/${orderId}/transitions`) && request.method() === "POST") {
      lastTransition = JSON.parse(request.postData() || "{}");
      orderStatus = String(lastTransition.status || orderStatus);
      return json({ order: { _id: orderId, status: orderStatus }, message: "Recogida confirmada. Ya puedes iniciar la ruta." });
    }
    if (path.includes("/api/v1/riders/")) return json({});
    return json({});
  });

  await page.addInitScript(() => {
    sessionStorage.setItem("piki-127.0.0.1-api-token", "e2e-token");
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
  });

  return { getLastTransition: () => lastTransition };
}

test("confirma la recogida sin QR/PIN", async ({ page }) => {
  const api = await mockRiderApi(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Confirmar recogida" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar recogida" }).click();
  await expect(page.getByRole("heading", { name: "Confirma la recogida" })).toBeVisible();
  await page.getByRole("button", { name: /Confirmar recogida sin QR\/PIN/ }).click();
  await expect(page.getByText("Recogida confirmada. Ya puedes iniciar la ruta.")).toBeVisible();
  expect(api.getLastTransition()).toMatchObject({ status: "picked_up", actorRole: "rider" });
  expect(api.getLastTransition()).not.toHaveProperty("pickupProof");
});

test("confirma la recogida con PIN opcional", async ({ page }) => {
  const api = await mockRiderApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Confirmar recogida" }).click();
  await page.getByRole("button", { name: "PIN", exact: true }).click();
  await page.getByLabel("PIN del establecimiento (opcional)").fill("4821");
  await page.getByRole("button", { name: "Confirmar recogida con PIN" }).click();
  await expect(page.getByText("Recogida confirmada. Ya puedes iniciar la ruta.")).toBeVisible();
  expect(api.getLastTransition()).toMatchObject({ status: "picked_up", pickupProof: { kind: "pin", value: "4821" } });
});
