/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const BUILD_ID = "offline-test-build";
const CACHE_PREFIX = "offline-rider";
const CACHE_NAME = `${CACHE_PREFIX}-${BUILD_ID}`;
const APP_SHELL = ["/", "/index.html"];
const ORIGIN = "https://rider.example";
const ASSET = "/assets/index-AbCd1234.js";
const template = readFileSync(new URL("../public/sw.template.js", import.meta.url), "utf8");
interface WorkerEvent {
  data?: { type?: string };
  source?: { postMessage: (message: unknown) => void };
  request?: Request;
  respondWith?: (promise: Promise<Response>) => void;
  waitUntil: (promise: Promise<unknown>) => void;
}
function basic(body = "<!doctype html><title>Public shell</title>", headers: Record<string, string> = { "content-type": "text/html" }, status = 200) {
  const response = new Response(body, { status, headers });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}
function request(path: string, navigate = false, init: RequestInit = {}) {
  const req = new Request(new URL(path, ORIGIN), init);
  if (navigate) Object.defineProperty(req, "mode", { value: "navigate" });
  return req;
}
function createWorker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const windowClients = ["/", "/delivery/current"].map((path) => ({
    url: `${ORIGIN}${path}`, navigate: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined), postMessage: vi.fn(),
  }));
  const entries = new Map<string, Response>();
  const key = (req: Request | string) => new URL(typeof req === "string" ? req : req.url, ORIGIN).href;
  const cache = {
    match: vi.fn(async (req: Request | string) => entries.get(key(req))?.clone()),
    put: vi.fn(async (req: Request | string, response: Response) => { entries.set(key(req), response.clone()); }),
  };
  const caches = {
    open: vi.fn(async (_name: string) => cache),
    match: vi.fn(async (_req: unknown) => basic("Unrelated/private cache")),
    keys: vi.fn(async () => [`${CACHE_PREFIX}-old-build`, CACHE_NAME, "unrelated-cache"]),
    delete: vi.fn(async (_name: string) => true),
  };
  const self = {
    addEventListener: (type: string, listener: (event: WorkerEvent) => void) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined), location: { origin: ORIGIN },
    clients: {
      claim: vi.fn(async () => undefined), matchAll: vi.fn(async (_options: unknown) => windowClients),
      openWindow: vi.fn(async (_url: string) => undefined),
    },
  };
  const fetch = vi.fn(async (_request: Request) => basic());
  const source = template.replaceAll("__BUILD_ID__", BUILD_ID).replaceAll("__CACHE_PREFIX__", CACHE_PREFIX).replaceAll("__APP_SHELL__", JSON.stringify(APP_SHELL));
  runInNewContext(source, { self, caches, fetch, URL, Request, Response, Headers, Date }, { filename: "sw.template.js", timeout: 1000 });
  async function dispatch(type: string, event: Omit<WorkerEvent, "waitUntil"> = {}) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const waitUntil = vi.fn((promise: Promise<unknown>) => { pending.push(promise); });
    const listener = listeners.get(type);
    if (!listener) throw new Error(`Missing service worker listener: ${type}`);
    listener({ ...event, waitUntil, respondWith: (promise) => { response = promise; } });
    const result = await response;
    await Promise.all(pending);
    return { waitUntil, response: result };
  }
  const offline = () => fetch.mockRejectedValue(new TypeError("Failed to fetch"));
  return { self, caches, cache, entries, windowClients, fetch, dispatch, offline };
}

describe("Rider service worker operation safety — offline VM tests", () => {
  it("installs only anonymous public HTML without skipping waiting", async () => {
    const w = createWorker();
    const result = await w.dispatch("install");
    expect(result.waitUntil).toHaveBeenCalledTimes(1);
    expect(w.cache.put).toHaveBeenCalledTimes(2);
    for (const [req] of w.fetch.mock.calls) {
      expect(req.credentials).toBe("omit");
      expect(req.cache).toBe("no-store");
      expect(req.redirect).toBe("error");
    }
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    expect(w.self.clients.claim).not.toHaveBeenCalled();
  });
  it("settles offline install failures without early activation", async () => {
    const w = createWorker(); w.offline();
    await expect(w.dispatch("install")).resolves.toBeDefined();
    expect(w.cache.put).not.toHaveBeenCalled();
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });
  it("preserves old builds for live clients and claims/notifies without reload", async () => {
    const w = createWorker(); await w.dispatch("install"); await w.dispatch("activate");
    expect(w.caches.delete).not.toHaveBeenCalled();
    expect(w.self.clients.claim).toHaveBeenCalledTimes(1);
    for (const client of w.windowClients) {
      expect(client.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "PIKI_SW_ACTIVATED", buildId: BUILD_ID });
      expect(client.navigate).not.toHaveBeenCalled(); expect(client.focus).not.toHaveBeenCalled();
    }
    expect(w.self.clients.openWindow).not.toHaveBeenCalled();
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });
  it("retains old caches when a new offline build has no shell even without clients", async () => {
    const w = createWorker(); w.windowClients.splice(0); w.offline();
    await w.dispatch("install"); await w.dispatch("activate");
    expect(w.caches.delete).not.toHaveBeenCalled();
  });
  it("cleans only owned old caches when shell is ready and no client depends on them", async () => {
    const w = createWorker(); w.windowClients.splice(0); await w.dispatch("install"); await w.dispatch("activate");
    expect(w.caches.delete).toHaveBeenCalledExactlyOnceWith(`${CACHE_PREFIX}-old-build`);
  });
  it("only skips waiting for the explicit client message", async () => {
    const w = createWorker(); await w.dispatch("install"); await w.dispatch("message", { data: { type: "OTHER" } });
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    await w.dispatch("message", { data: { type: "SKIP_WAITING" } });
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
  });
  it("preserves build ID messaging", async () => {
    const w = createWorker(); const postMessage = vi.fn();
    await w.dispatch("message", { data: { type: "GET_BUILD_ID" }, source: { postMessage } });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "PIKI_SW_BUILD_ID", buildId: BUILD_ID });
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });
  it.each(["/", "/?piki_build=c0b1314f0a37", "/delivery/current"])("handles rejected cold navigation %s with truthful no-store offline HTML", async (path) => {
    const w = createWorker(); w.offline();
    const { response } = await w.dispatch("fetch", { request: request(path, true) });
    expect(response?.status).toBe(503); expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.text()).toMatch(/Sin conexión.*pedidos, GPS.*Reintentar/s);
    expect(w.caches.match).not.toHaveBeenCalled();
  });
  it("serves only installed public HTML on warm offline navigation", async () => {
    const w = createWorker(); await w.dispatch("install"); w.offline();
    const { response } = await w.dispatch("fetch", { request: request("/delivery/current", true) });
    expect(response?.status).toBe(200); expect(await response?.text()).toContain("Public shell");
    expect(w.caches.open.mock.calls.every(([name]) => name === CACHE_NAME)).toBe(true);
    expect(w.caches.match).not.toHaveBeenCalled();
  });
  it.each(["/", ASSET])("settles rejected cold static fetch %s with controlled 503", async (path) => {
    const w = createWorker(); w.offline();
    expect((await w.dispatch("fetch", { request: request(path) })).response?.status).toBe(503);
    expect(w.cache.put).not.toHaveBeenCalled();
  });
  it("serves warm hashed assets offline and keeps their immutable lifetime", async () => {
    const w = createWorker(); w.fetch.mockResolvedValue(basic("console.log('real');", { "content-type": "text/javascript" }));
    await w.dispatch("fetch", { request: request(ASSET) });
    const cached = w.entries.get(`${ORIGIN}${ASSET}`)!;
    cached.headers.set("x-piki-cached-at", String(Date.now() - 48 * 60 * 60 * 1000));
    w.offline(); const { response } = await w.dispatch("fetch", { request: request(ASSET) });
    expect(response?.status).toBe(200); expect(await response?.text()).toContain("console.log");
  });
  it("expires public shell after 24 hours", async () => {
    const w = createWorker(); await w.dispatch("install");
    w.entries.get(`${ORIGIN}/`)!.headers.set("x-piki-cached-at", String(Date.now() - 25 * 60 * 60 * 1000));
    w.offline(); expect((await w.dispatch("fetch", { request: request("/", true) })).response?.status).toBe(503);
  });
  it.each([
    { "content-type": "application/json" }, { "content-type": "text/html", "cache-control": "private" },
    { "content-type": "text/html", "cache-control": "no-store" }, { "content-type": "text/html", "set-cookie": "secret=1" },
  ] as Record<string, string>[])("does not install nonpublic/non-HTML shell %j", async (headers) => {
    const w = createWorker(); w.fetch.mockResolvedValue(basic("not public shell", headers));
    await w.dispatch("install"); expect(w.cache.put).not.toHaveBeenCalled();
  });
  it("does not install redirected or error shell", async () => {
    const w = createWorker(); const redirected = basic(); Object.defineProperty(redirected, "redirected", { value: true });
    w.fetch.mockResolvedValueOnce(redirected).mockResolvedValueOnce(basic("error", { "content-type": "text/html" }, 500));
    await w.dispatch("install"); expect(w.cache.put).not.toHaveBeenCalled();
  });
  it("never stores runtime authenticated navigation HTML", async () => {
    const w = createWorker(); const { response } = await w.dispatch("fetch", { request: request("/", true) });
    expect(response?.status).toBe(200); expect(w.cache.put).not.toHaveBeenCalled();
    expect(w.fetch.mock.calls[0][0].cache).toBe("no-store");
  });
  it("rejects legacy/unmarked cached HTML and marked non-HTML", async () => {
    const w = createWorker(); w.entries.set(`${ORIGIN}/`, basic("Private legacy HTML")); w.offline();
    expect((await w.dispatch("fetch", { request: request("/", true) })).response?.status).toBe(503);
    w.entries.set(`${ORIGIN}/`, new Response("{}", { headers: { "content-type": "application/json", "x-piki-public-shell": "1", "x-piki-cached-at": String(Date.now()) } }));
    expect((await w.dispatch("fetch", { request: request("/", true) })).response?.status).toBe(503);
  });
  it("cache.put rejection never invalidates successful network or rejects waitUntil", async () => {
    const w = createWorker(); w.cache.put.mockRejectedValue(new Error("Quota exceeded"));
    w.fetch.mockResolvedValue(basic("real script", { "content-type": "text/javascript" }));
    expect((await w.dispatch("fetch", { request: request(ASSET) })).response?.status).toBe(200);
    expect(w.cache.put).toHaveBeenCalledTimes(1);
    expect(w.fetch.mock.calls[0][0].credentials).toBe("omit");
  });
  it("never caches an unexpected HTML response for a hashed asset", async () => {
    const w = createWorker();
    expect((await w.dispatch("fetch", { request: request(ASSET) })).response?.status).toBe(200);
    expect(w.cache.put).not.toHaveBeenCalled();
  });
  it("cache open/match failures do not invalidate network or offline fallback", async () => {
    const w = createWorker(); w.caches.open.mockRejectedValue(new Error("Storage unavailable"));
    expect((await w.dispatch("fetch", { request: request(ASSET) })).response?.status).toBe(200);
    w.offline(); expect((await w.dispatch("fetch", { request: request("/", true) })).response?.status).toBe(503);
    await expect(w.dispatch("install")).resolves.toBeDefined();
  });
  it("never caches or replaces network HTTP errors", async () => {
    const w = createWorker(); w.fetch.mockResolvedValue(basic("real 502", {}, 502));
    const { response } = await w.dispatch("fetch", { request: request(ASSET) });
    expect(response?.status).toBe(502); expect(await response?.text()).toBe("real 502"); expect(w.cache.put).not.toHaveBeenCalled();
  });
  it.each(["/api", "/api/orders", "/auth", "/auth/login", "/orders", "/gps", "/live/status", "/release.json", "/sw.js", "/manifest.json", "https://other.example/assets/index-AbCd1234.js"])("does not intercept API/live/control/cross-origin request %s", async (path) => {
    const w = createWorker(); w.offline();
    expect((await w.dispatch("fetch", { request: request(path) })).response).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled(); expect(w.caches.open).not.toHaveBeenCalled();
  });
  it.each([{ headers: { authorization: "Bearer secret" } }, { headers: { "cache-control": "max-age=0, no-store" } }, { method: "POST" }] as RequestInit[])("bypasses authorized/no-store/non-GET requests %j", async (init) => {
    const w = createWorker(); expect((await w.dispatch("fetch", { request: request(ASSET, false, init) })).response).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
  });
});
