const BUILD_ID = "__BUILD_ID__";
const CACHE_PREFIX = "__CACHE_PREFIX__-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const APP_SHELL = __APP_SHELL__;
const CONTROL_PATHS = new Set(["/sw.js", "/release.json", "/manifest.json"]);

function isControlRequest(request, url) {
  return CONTROL_PATHS.has(url.pathname)
    || url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/auth/")
    || request.headers.has("authorization")
    || request.headers.get("cache-control") === "no-store";
}

function canCache(response) {
  const cacheControl = response.headers.get("cache-control") || "";
  return response.ok
    && response.type === "basic"
    && !response.headers.has("authorization")
    && !response.headers.has("set-cookie")
    && !/\b(?:no-store|private)\b/i.test(cacheControl);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(APP_SHELL.map((asset) => cache.add(asset)));
    // Keep the worker waiting. The safe, explicit UI owns activation.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: "PIKI_SW_ACTIVATED", buildId: BUILD_ID }));
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
  if (event.data?.type === "GET_BUILD_ID") event.source?.postMessage({ type: "PIKI_SW_BUILD_ID", buildId: BUILD_ID });
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isControlRequest(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(new Request(request, { cache: "no-store" })).catch(async () => (await caches.match("/")) || Response.error()));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (canCache(response) && url.pathname.startsWith("/assets/")) {
      const cache = await caches.open(CACHE_NAME);
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    payload = parsed && typeof parsed === "object" ? parsed : {};
  } catch { payload = { body: event.data?.text() || "" }; }
  const title = typeof payload.title === "string" ? payload.title : "PIKI Riders";
  const body = typeof payload.body === "string" ? payload.body : "Tienes una actualización.";
  const category = typeof payload.category === "string"
    ? payload.category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    : "";
  const urgentAssignment = Boolean(payload.urgent) || /(^|[._-])(assignment|offer|rider_offer|pedido|asignacion|asignado|asignada)([._-]|$)/i.test(category);
  let path = "/";
  if (typeof payload.url === "string") {
    try {
      const destination = new URL(payload.url, self.location.origin);
      if (destination.origin === self.location.origin) path = `${destination.pathname}${destination.search}${destination.hash}`;
    } catch { /* Invalid notification paths fall back to the app home. */ }
  }
  const tag = typeof payload.tag === "string" ? payload.tag : typeof payload.id === "string" ? `piki-${payload.id}` : "";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/piki-mascot-192.png",
    badge: "/piki-mascot-192.png",
    ...(tag ? { tag, renotify: Boolean(payload.renotify) } : {}),
    timestamp: Number.isFinite(Number(payload.timestamp)) ? Number(payload.timestamp) : Date.now(),
    requireInteraction: Boolean(payload.requireInteraction) || urgentAssignment,
    ...(urgentAssignment ? { vibrate: [180, 100, 180, 100, 180] } : {}),
    actions: [{ action: "open", title: "Abrir aviso" }],
    data: { path, category, id: typeof payload.id === "string" ? payload.id : undefined },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path || "/";
  const targetUrl = new URL(path, self.location.origin);
  const target = (targetUrl.origin === self.location.origin ? targetUrl : new URL("/", self.location.origin)).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));
    if (existing) { await existing.navigate(target).catch(() => undefined); return existing.focus(); }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => clients.forEach((client) => client.postMessage({ type: "PIKI_PUSH_SUBSCRIPTION_CHANGED" }))));
});
