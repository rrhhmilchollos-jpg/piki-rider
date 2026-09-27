import { test, expect, type Page } from "@playwright/test";

const orderId = "order-e2e-pickup";

async function mockRiderApi(
  page: Page,
  paymentMethod: "cash" | "stripe" = "stripe",
  initialOrderStatus: "ready_for_pickup" | "preparing" = "ready_for_pickup",
) {
  let orderStatus = initialOrderStatus;
  let lastTransition: Record<string, unknown> | null = null;
  let lastPickupProof: Record<string, unknown> | null = null;

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
    if (path.endsWith("/offers")) return json({ offers: [{ _id: orderId, assignmentState: "assigned", status: orderStatus, restaurant: { name: "Restaurante E2E", address: "Calle Test 1" }, customerName: "Cliente E2E", deliveryAddress: "Calle Cliente 2", paymentMethod, totalCents: 2909, items: [] }] });
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
    if (path.includes("/api/v1/riders/")) return json({});
    return json({});
  });

  await page.addInitScript(() => {
    sessionStorage.setItem("piki-127.0.0.1-api-token", "e2e-token");
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
  });

  return {
    getLastTransition: () => lastTransition,
    getLastPickupProof: () => lastPickupProof,
  };
}

test("confirma la recogida sin QR/PIN", async ({ page }) => {
  const api = await mockRiderApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Confirmar recogida sin QR/PIN", exact: true }).click();
  await expect(page.getByText("Recogida confirmada. Ya puedes iniciar la ruta.")).toBeVisible();
  expect(api.getLastTransition()).toMatchObject({ status: "picked_up", actorRole: "rider" });
  expect(api.getLastPickupProof()).toBeNull();
});

test("espera a que el establecimiento marque el pedido como listo", async ({ page }) => {
  const api = await mockRiderApi(page, "stripe", "preparing");
  await page.goto("/");

  await expect(page.getByText("El establecimiento está preparando el pedido. La recogida se habilitará automáticamente cuando lo marque como listo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar recogida sin QR/PIN", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Validar QR/PIN (opcional)", exact: true })).toHaveCount(0);
  expect(api.getLastTransition()).toBeNull();
  expect(api.getLastPickupProof()).toBeNull();
});

test("confirma la recogida con PIN opcional", async ({ page }) => {
  const api = await mockRiderApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Validar QR/PIN (opcional)", exact: true }).click();
  await page.getByLabel("PIN alfanumérico del pedido (opcional)").fill("4821");
  await page.getByRole("button", { name: "Autorizar recogida" }).click();
  await expect(page.getByText("Recogida confirmada. Ya puedes iniciar la ruta.")).toBeVisible();
  expect(api.getLastPickupProof()).toMatchObject({ pickupPin: "4821", pickupQr: "4821" });
});

test("oculta el cobro al ir al local y muestra el efectivo al ver al cliente", async ({ page }) => {
  await mockRiderApi(page, "cash");
  await page.goto("/");
  await expect(page.getByText("No tienes que pagar en el establecimiento")).toBeVisible();
  await expect(page.getByText("Cobrar en efectivo al cliente")).not.toBeVisible();

  await page.getByRole("button", { name: "Confirmar recogida sin QR/PIN", exact: true }).click();
  await page.reload();

  await expect(page.getByText("Cliente E2E")).toBeVisible();
  await expect(page.getByText("Calle Cliente 2")).toBeVisible();
  await expect(page.getByText("Cobrar en efectivo al cliente")).toBeVisible();
  await expect(page.getByText(/29,09/)).toBeVisible();
  await expect(page.getByText("No tienes que pagar en el establecimiento")).not.toBeVisible();
});

test("muestra pagado online solo en la vista del cliente", async ({ page }) => {
  await mockRiderApi(page, "stripe");
  await page.goto("/");
  await expect(page.getByText("Pagado online")).not.toBeVisible();

  await page.getByRole("button", { name: "Confirmar recogida sin QR/PIN", exact: true }).click();
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
  expect(telemetry.starts).toBe(20);
  expect(telemetry.vibrations).toEqual([[
    250, 120, 250, 120, 350, 120, 350, 120, 450, 120, 450, 120, 550, 120, 550,
    120, 650, 120, 650,
  ]]);
});
