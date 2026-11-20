const BUILD_ID = "87ceec058645";
const CACHE_PREFIX = "piki-rider-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const APP_SHELL = ["/","/manifest.json","/piki-mascot-192.png","/piki-mascot-512.png"];
const CONTROL_PATHS = new Set(["/sw.js", "/release.json", "/manifest.json"]);
const SHELL_TTL_MS = 24 * 60 * 60 * 1000;
const CACHED_AT = "x-piki-cached-at";
const PUBLIC_SHELL = "x-piki-public-shell";
const HASHED_ASSET = /^\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9]+$/;

function isControlRequest(request, url) {
  return CONTROL_PATHS.has(url.pathname)
    || /^\/(?:api|auth)(?:\/|$)/.test(url.pathname)
    || request.headers.has("authorization")
    || /\bno-store\b/i.test(request.headers.get("cache-control") || "");
}

function canCache(response) {
  const cacheControl = response.headers.get("cache-control") || "";
  return response.ok
    && response.type === "basic"
    && !response.redirected
    && !response.headers.has("authorization")
    && !response.headers.has("set-cookie")
    && !/\b(?:no-store|private)\b/i.test(cacheControl);
}

function isHTML(response) {
  return /^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") || "");
}

function isFresh(response, hashed = false) {
  const stamp = Number(response?.headers.get(CACHED_AT));
  return Boolean(response?.ok && stamp > 0 && stamp <= Date.now()
    && (hashed || Date.now() - stamp < SHELL_TTL_MS));
}

async function readCached(request, publicShell = false) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(request);
    const path = new URL(typeof request === "string" ? request : request.url, self.location.origin).pathname;
    if (!isFresh(response, HASHED_ASSET.test(path))) return undefined;
    if (publicShell && (response.headers.get(PUBLIC_SHELL) !== "1" || !isHTML(response))) return undefined;
    return response;
  } catch { return undefined; }
}

async function storePublic(request, response, shell = false) {
  if (!canCache(response) || (shell && !isHTML(response))) return;
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, String(Date.now()));
  if (shell) headers.set(PUBLIC_SHELL, "1");
  const cached = new Response(response.clone().body, { status: response.status, statusText: response.statusText, headers });
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, cached);
}

function offlineResponse(navigation = false) {
  const body = navigation
    ? '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PIKI — Sin conexión</title><body><h1>Sin conexión</h1><p>No se pueden consultar pedidos, GPS ni estados en vivo. Comprueba tu conexión e inténtalo de nuevo.</p><button onclick="location.reload()">Reintentar</button></body></html>'
    : "Recurso no disponible sin conexión. Reintenta cuando tengas conexión.";
  return new Response(body, { status: 503, headers: {
    "Content-Type": navigation ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await Promise.allSettled(APP_SHELL.map(async (asset) => {
      const url = new URL(asset, self.location.origin);
      const request = new Request(url, { credentials: "omit", cache: "no-store", redirect: "error" });
      if (url.origin !== self.location.origin || isControlRequest(new Request(url), url)) return;
      const response = await fetch(request);
      // Only anonymous, non-redirected public HTML can become the offline shell.
      await storePublic(asset, response, url.pathname === "/" || url.pathname === "/index.html");
    }));
    // First installs activate normally; updates wait for the client to send
    // SKIP_WAITING after confirming that no rider operation is active.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Never discard the previous build while an existing client may need its assets,
    // or while this build has no usable public shell (e.g. an offline installation).
    if (!clients.length && await readCached("/", true)) {
      try {
        const keys = await caches.keys();
        await Promise.allSettled(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
      } catch { /* Cache storage is best effort. */ }
    }
    await self.clients.claim();
    clients.forEach((client) => {
      client.postMessage({ type: "PIKI_SW_ACTIVATED", buildId: BUILD_ID });
    });
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
    event.respondWith((async () => {
      try { return await fetch(new Request(request, { cache: "no-store" })); }
      catch { return (await readCached("/", true)) || offlineResponse(true); }
    })());
    return;
  }

  const shell = url.pathname === "/" || url.pathname === "/index.html";
  const staticAsset = HASHED_ASSET.test(url.pathname) || APP_SHELL.includes(url.pathname);
  // API/live requests, including endpoints outside /api, remain native network requests.
  if (!shell && !staticAsset) return;
  event.respondWith((async () => {
    const cached = await readCached(request, shell);
    if (cached) return cached;
    try {
      const response = await fetch(shell ? request : new Request(request, { credentials: "omit" }));
      // Runtime HTML might be authenticated; only install's anonymous fetch stores it.
      if (!shell && !isHTML(response)) event.waitUntil(storePublic(request, response).catch(() => undefined));
      return response;
    } catch { return offlineResponse(shell); }
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || "" }; }
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
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));
    if (existing) { await existing.navigate(target).catch(() => undefined); return existing.focus(); }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => clients.forEach((client) => client.postMessage({ type: "PIKI_PUSH_SUBSCRIPTION_CHANGED" }))));
});
