/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const BUILD_ID = "offline-test-build";
const CACHE_PREFIX = "offline-rider";
const CACHE_NAME = `${CACHE_PREFIX}-${BUILD_ID}`;
const APP_SHELL = ["/", "/index.html"];
const template = readFileSync(new URL("../public/sw.template.js", import.meta.url), "utf8");

interface WorkerEvent {
  data?: { type?: string };
  source?: { postMessage: (message: unknown) => void };
  waitUntil: (promise: Promise<unknown>) => void;
}

function createWorker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const windowClients = ["/", "/delivery/current"].map((path) => ({
    url: `https://rider.example${path}`,
    navigate: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    postMessage: vi.fn(),
  }));
  const cache = { add: vi.fn(async (_asset: string) => undefined) };
  const caches = {
    open: vi.fn(async (_name: string) => cache),
    keys: vi.fn(async () => [`${CACHE_PREFIX}-old-build`, CACHE_NAME, "unrelated-cache"]),
    delete: vi.fn(async (_name: string) => true),
  };
  const self = {
    addEventListener: (type: string, listener: (event: WorkerEvent) => void) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    location: { origin: "https://rider.example" },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async (_options: unknown) => windowClients),
      openWindow: vi.fn(async (_url: string) => undefined),
    },
  };
  const fetch = vi.fn(() => { throw new Error("Network access is forbidden in this offline test"); });
  const source = template
    .replaceAll("__BUILD_ID__", BUILD_ID)
    .replaceAll("__CACHE_PREFIX__", CACHE_PREFIX)
    .replaceAll("__APP_SHELL__", JSON.stringify(APP_SHELL));
  runInNewContext(source, { self, caches, fetch, URL }, { filename: "sw.template.js", timeout: 1000 });

  async function dispatch(type: string, event: Omit<WorkerEvent, "waitUntil"> = {}) {
    const pending: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => { pending.push(promise); });
    const listener = listeners.get(type);
    if (!listener) throw new Error(`Missing service worker listener: ${type}`);
    listener({ ...event, waitUntil });
    await Promise.all(pending);
    return waitUntil;
  }

  return { self, caches, cache, windowClients, fetch, dispatch };
}

describe("Rider service worker operation safety — offline VM tests", () => {
  it("pre-caches the app shell without skipping the waiting phase on install", async () => {
    const worker = createWorker();
    const waitUntil = await worker.dispatch("install");

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(worker.caches.open).toHaveBeenCalledWith(CACHE_NAME);
    expect(worker.cache.add.mock.calls.map(([asset]) => asset)).toEqual(APP_SHELL);
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    expect(worker.self.clients.claim).not.toHaveBeenCalled();
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("keeps install resilient to an unavailable shell asset without activating early", async () => {
    const worker = createWorker();
    worker.cache.add.mockRejectedValueOnce(new Error("Offline asset unavailable"));

    await expect(worker.dispatch("install")).resolves.toBeDefined();
    expect(worker.cache.add).toHaveBeenCalledTimes(APP_SHELL.length);
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("claims and notifies every window on activation without navigating or opening a window", async () => {
    const worker = createWorker();
    const waitUntil = await worker.dispatch("activate");

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(worker.caches.delete).toHaveBeenCalledExactlyOnceWith(`${CACHE_PREFIX}-old-build`);
    expect(worker.self.clients.claim).toHaveBeenCalledTimes(1);
    expect(worker.self.clients.matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    for (const client of worker.windowClients) {
      expect(client.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "PIKI_SW_ACTIVATED", buildId: BUILD_ID });
      expect(client.navigate).not.toHaveBeenCalled();
      expect(client.focus).not.toHaveBeenCalled();
    }
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("only skips waiting when the client explicitly sends SKIP_WAITING", async () => {
    const worker = createWorker();
    await worker.dispatch("install");
    await worker.dispatch("message");
    await worker.dispatch("message", { data: { type: "UNRELATED_MESSAGE" } });
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();

    const waitUntil = await worker.dispatch("message", { data: { type: "SKIP_WAITING" } });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(worker.self.skipWaiting).toHaveBeenCalledTimes(1);
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("preserves the build ID message without skipping waiting", async () => {
    const worker = createWorker();
    const postMessage = vi.fn();

    const waitUntil = await worker.dispatch("message", { data: { type: "GET_BUILD_ID" }, source: { postMessage } });

    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "PIKI_SW_BUILD_ID", buildId: BUILD_ID });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    expect(worker.fetch).not.toHaveBeenCalled();
  });
});
