import { test, expect, type Page } from "@playwright/test";

const orderId = "order-e2e-pickup";

async function mockRiderApi(
  page: Page,
  paymentMethod: "cash" | "stripe" = "stripe",
  initialOrderStatus: "pending" | "ready_for_pickup" | "preparing" | "on_the_way" = "ready_for_pickup",
  initialShiftStatus: "active" | "finished" = "active",
  initialAssignmentState: "offered" | "assigned" = "assigned",
) {
  let orderStatus = initialOrderStatus;
  let lastTransition: Record<string, unknown> | null = null;
  let lastPickupProof: Record<string, unknown> | null = null;
  let lastDeliveryProof: Record<string, unknown> | null = null;

  await page.route("https://api.pikidelivery.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/v1/riders/session") return json({ rider: { id: "rider-e2e", status: "active" } });
    if (path.endsWith("/slots")) return json({ slots: [] });
    if (path === "/api/v1/riders/statistics") return json({ statistics: {} });
    if (path.endsWith("/shift")) return json({ eligible: true, shift: { status: initialShiftStatus, zone: "E2E" } });
    if (path.endsWith("/cash-wallet")) return json({ wallet: { availableCents: 0, collectedCents: 0, handedOverCents: 0, collectedEntries: 0 } });
    if (path.endsWith("/offers")) return json({ offers: [{ _id: orderId, assignmentState: initialAssignmentState, status: orderStatus, restaurant: { name: "Restaurante E2E", address: "Calle Test 1" }, customerName: "Cliente E2E", deliveryAddress: "Calle Cliente 2", paymentMethod, totalCents: 2909, items: [] }] });
    if (path.endsWith(`/orders/${orderId}/transitions`) && request.method() === "POST") {
      lastTransition = JSON.parse(request.postData() || "{}");
      orderStatus = String(lastTransition.status || orderStatus);
      return json({ order: { _id: orderId, status: orderStatus }, message: "Recogida confirmada. Ya puedes iniciar la ruta." });
    }
    if (path.endsWith(`/orders/${orderId}/confirm-pickup`) && request.method() === "POST") {
      lastPickupProof = JSON.parse(request.postData() || "{}");
      orderStatus = "picked_up";
      return json({ order: { _id: orderId, status: orderStatus }, message: "Recogida confirmada. Ya puedes iniciar la ruta." });
    }
    if (path.endsWith(`/orders/${orderId}/confirm-delivery`) && request.method() === "POST") {
      lastDeliveryProof = JSON.parse(request.postData() || "{}");
      orderStatus = "delivered";
      return json({ order: { _id: orderId, status: orderStatus }, message: "Entrega confirmada. El reparto se ha cerrado correctamente." });
    }
    if (path.includes("/api/v1/riders/")) return json({});
    return json({});
  });

  await page.addInitScript(() => {
    sessionStorage.setItem("piki-127.0.0.1-api-token", "e2e-token");
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
  });
  await page.context().grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4173" });
  await page.context().setGeolocation({ latitude: 38.99, longitude: -0.52 });

  return {
    getLastTransition: () => lastTransition,
    getLastPickupProof: () => lastPickupProof,
    getLastDeliveryProof: () => lastDeliveryProof,
  };
}

test("la pantalla Ofertas ya no ofrece crear pedidos de prueba", async ({ page }) => {
  await mockRiderApi(page, "stripe", "ready_for_pickup", "finished");
  await page.goto("/?section=Ofertas");

  await expect(page.getByRole("heading", { name: "Repartos asignados a tu jornada." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear pedido de prueba" })).toHaveCount(0);
  await expect(page.getByText("Solo para comprobar el flujo completo; no genera ningún cobro.")).toHaveCount(0);
});

test("confirma la recogida sin QR/PIN", async ({ page }) => {
  const api = await mockRiderApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Confirmar recogida", exact: true }).click();
  await expect(page.getByText("Recogida confirmada. Ya puedes iniciar la ruta.")).toBeVisible();
  expect(api.getLastTransition()).toMatchObject({ status: "picked_up", actorRole: "rider" });
  expect(api.getLastPickupProof()).toBeNull();
});

test("muestra Confirmar recogida para un pedido que aún está pendiente del Partner", async ({ page }) => {
  const api = await mockRiderApi(page, "stripe", "pending", "active", "offered");
  await page.goto("/");
  await expect(page.locator(".active-route-title")).toContainText("Nuevo pedido");
  const button = page.getByRole("button", { name: "Confirmar recogida", exact: true });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByText("Recogida confirmada. Ya puedes iniciar la ruta.")).toBeVisible();
  expect(api.getLastTransition()).toMatchObject({ status: "picked_up", actorRole: "rider" });
});
test("espera a que el establecimiento marque el pedido como listo", async ({ page }) => {
  const api = await mockRiderApi(page, "stripe", "preparing");
  await page.goto("/");

  await expect(page.locator(".active-route-title")).toContainText("Ve al establecimiento");
  await expect(page.getByText("No tienes que pagar en el establecimiento")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar recogida", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar recogida", exact: true }).click();
  await expect(page.getByText("Recogida confirmada. Ya puedes iniciar la ruta.")).toBeVisible();
  expect(api.getLastTransition()).toMatchObject({ status: "picked_up", actorRole: "rider" });
  expect(api.getLastPickupProof()).toBeNull();
});

test("exige el PIN del cliente antes de confirmar la entrega", async ({ page }) => {
  const api = await mockRiderApi(page, "stripe", "on_the_way");
  await page.goto("/");
  await page.getByRole("button", { name: "Escanear QR o PIN del cliente" }).click();
  await expect(page.getByRole("button", { name: "Confirmar entrega con QR/PIN" })).toBeDisabled();
  await page.getByLabel("PIN o código QR obligatorio del Customer").fill("4821");
  await page.getByRole("button", { name: "Confirmar entrega con QR/PIN" }).click();
  await expect(page.getByText("Entrega confirmada. El reparto se ha cerrado correctamente.")).toBeVisible();
  expect(api.getLastDeliveryProof()).toMatchObject({ deliveryQr: "4821", deliveryPin: "4821" });
});

test("oculta el cobro al ir al local y muestra el efectivo al ver al cliente", async ({ page }) => {
  await mockRiderApi(page, "cash");
  await page.goto("/");
  await expect(page.getByText("No tienes que pagar en el establecimiento")).toBeVisible();
  await expect(page.getByText("Cobrar en efectivo al cliente")).not.toBeVisible();

  await page.getByRole("button", { name: "Confirmar recogida", exact: true }).click();
  await page.reload();

  await expect(page.getByRole("heading", { name: "Cliente E2E" })).toBeVisible();
  await expect(page.locator(".active-order-detail").getByText("Calle Cliente 2")).toBeVisible();
  await expect(page.getByText("Cobrar en efectivo al cliente")).toBeVisible();
  await expect(page.getByText(/29,09/)).toBeVisible();
  await expect(page.getByText("No tienes que pagar en el establecimiento")).not.toBeVisible();
});

test("muestra pagado online solo en la vista del cliente", async ({ page }) => {
  await mockRiderApi(page, "stripe");
  await page.goto("/");
  await expect(page.getByText("Pagado online")).not.toBeVisible();

  await page.getByRole("button", { name: "Confirmar recogida", exact: true }).click();
  await page.reload();

  await expect(page.getByText("Pagado online")).toBeVisible();
  await expect(page.getByText("Cobrar en efectivo al cliente")).not.toBeVisible();
});

test("avisa con sonido y vibración al recibir una nueva oferta", async ({ page }) => {
  let offerRequests = 0;

  await page.route("https://api.pikidelivery.com/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/v1/riders/session") return json({ rider: { id: "rider-alert", status: "active" } });
    if (path.endsWith("/slots")) return json({ slots: [] });
    if (path === "/api/v1/riders/statistics") return json({ statistics: {} });
    if (path.endsWith("/shift")) return json({ eligible: true, shift: { status: "active", zone: "E2E" } });
    if (path.endsWith("/cash-wallet")) return json({ wallet: { availableCents: 0, collectedCents: 0, handedOverCents: 0, collectedEntries: 0 } });
    if (path.endsWith("/offers")) {
      offerRequests += 1;
      return json({ offers: offerRequests === 1 ? [] : [{ _id: "order-alert", assignmentState: "offered", status: "ready_for_pickup", restaurant: { name: "Restaurante alerta", address: "Calle Alerta 1" }, items: [] }] });
    }
    if (path === "/api/v1/realtime/events") return route.fulfill({ status: 204 });
    return json({});
  });

  await page.addInitScript(() => {
    const telemetry = { resumes: 0, starts: 0, vibrations: [] as number[][] };
    (window as unknown as { __riderAlertTelemetry: typeof telemetry }).__riderAlertTelemetry = telemetry;

    class FakeAudioContext {
      currentTime = 0;
      destination = {} as AudioDestinationNode;
      resume() { telemetry.resumes += 1; return Promise.resolve(); }
      createOscillator() {
        return {
          type: "sine",
          frequency: { value: 0 },
          connect() {},
          start() { telemetry.starts += 1; },
          stop() {},
        } as unknown as OscillatorNode;
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        } as unknown as GainNode;
      }
    }

    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number[]) => { telemetry.vibrations.push(pattern); return true; },
    });
    sessionStorage.setItem("piki-127.0.0.1-api-token", "e2e-token");
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
  });

  await page.context().grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4173" });
  await page.context().setGeolocation({ latitude: 38.99, longitude: -0.52 });
  await page.goto("/");
  await page.waitForFunction(
    () => (window as unknown as { __riderAlertTelemetry: { vibrations: number[][] } }).__riderAlertTelemetry.vibrations.length === 1,
    undefined,
    { timeout: 9_000 },
  );

  const telemetry = await page.evaluate(
    () => (window as unknown as { __riderAlertTelemetry: { resumes: number; starts: number; vibrations: number[][] } }).__riderAlertTelemetry,
  );
  expect(telemetry.resumes).toBeGreaterThan(0);
  expect(telemetry.starts).toBe(6);
  expect(telemetry.vibrations).toEqual([[180, 100, 180, 100, 180, 260, 320, 100, 320, 100, 320]]);
});
