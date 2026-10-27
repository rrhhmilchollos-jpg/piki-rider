const BUILD_ID = "__BUILD_ID__";
const CACHE_PREFIX = "__CACHE_PREFIX__-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const APP_SHELL = __APP_SHELL__;
const CONTROL_PATHS = new Set(["/sw.js", "/release.json", "/manifest.json"]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(APP_SHELL.map((asset) => cache.add(asset)));

    // PIKI Riders publica versiones compatibles y necesita aplicar el nuevo
    // shell sin exigir que el rider desinstale la PWA.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    );

    await self.clients.claim();

    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    for (const client of clients) {
      client.postMessage({
        type: "PIKI_SW_ACTIVATED",
        buildId: BUILD_ID,
      });
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }

  if (event.data?.type === "GET_BUILD_ID") {
    event.source?.postMessage({
      type: "PIKI_SW_BUILD_ID",
      buildId: BUILD_ID,
    });
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (CONTROL_PATHS.has(url.pathname)) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/auth/")) return;
  if (request.headers.has("authorization")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const freshRequest = new Request(request, { cache: "no-store" });
        const response = await fetch(freshRequest);

        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/", response.clone());
        }

        return response;
      } catch {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === "basic" && url.pathname.startsWith("/assets/")) {
      const cache = await caches.open(CACHE_NAME);
      event.waitUntil(cache.put(request, response.clone()));
    }

    return response;
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || "" };
  }

  const title = typeof payload.title === "string" ? payload.title : "PIKI Riders";
  const body = typeof payload.body === "string" ? payload.body : "Tienes una actualización.";
  const path = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/";

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/piki-mascot-192.png",
    badge: "/piki-mascot-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : "piki-riders-notification",
    renotify: Boolean(payload.renotify),
    data: { path },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.path || "/", self.location.origin).href;

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));

    if (existing) {
      await existing.navigate(target).catch(() => undefined);
      return existing.focus();
    }

    return self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => clients.forEach((client) => client.postMessage({
        type: "PIKI_PUSH_SUBSCRIPTION_CHANGED",
      }))),
  );
});
