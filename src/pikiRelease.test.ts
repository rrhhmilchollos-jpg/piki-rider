/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import * as navigation from "./pikiPwaUpdate";
import { shouldDeferPwaActivation } from "./pwaUpdateRecovery";
import { withRequestDeadline } from "./requestDeadline";
import { findNode, jsx, loadComponent } from "./test/offlineComponent";

function fixture({ active = false, known = true, stage = "", worker = true, gate = "ready", newBuild = true } = {}) {
  const safety = { known, active };
  const beginAt = (at: string) => { if (stage === at) safety.active = true; };
  const postMessage = vi.fn();
  const reload = vi.fn();
  const replace = vi.fn();
  const unregister = vi.fn(async () => { beginAt("unregister"); return true; });
  const registration = { scope: "https://mock.invalid/", active: { scriptURL: "https://mock.invalid/sw.js" }, waiting: worker ? { postMessage, scriptURL: "https://mock.invalid/sw.js" } : null,
    update: vi.fn(async () => { beginAt("update"); }), unregister };
  const serviceWorker = {
    controller: null,
    register: vi.fn(async () => { beginAt("register"); return registration; }),
    getRegistrations: vi.fn(async () => { beginAt("registrations"); return [registration, { scope: "https://mock.invalid/", active: { scriptURL: "https://mock.invalid/sw.js" }, unregister }]; }),
  };
  const cache = {
    keys: vi.fn(async () => { beginAt("keys"); return ["piki-rider-fixture-a", "piki-rider-fixture-b", "unrelated-cache"]; }),
    delete: vi.fn(async (_key: string) => { beginAt("delete"); return true; }),
  };
  const fetch = vi.fn(async () => new Response("<!doctype html><html><body>PIKI</body></html>", { headers: { "Content-Type": "text/html" } }));
  const states: unknown[] = [gate, "", newBuild ? "1.0.15 · fixture-new" : "", "", false, false, false, 0];
  let index = 0;
  const callbacks: (() => Promise<void>)[] = [];
  const navigator = { onLine: true, serviceWorker };
  const component = loadComponent("src/pikiRelease.tsx", {
    react: {
      useState: () => { const slot = index++; return [states[slot], (value: unknown) => { states[slot] = value; }]; },
      useRef: (value: unknown) => ({ current: value }), useEffect: () => {},
      useCallback: (callback: () => Promise<void>) => { callbacks.push(callback); return callback; },
    },
    "react/jsx-runtime": jsx, "@capacitor/core": { Capacitor: { isNativePlatform: () => false } },
    "./release-meta": { PIKI_RELEASE: { surface: "rider", version: "1.0.15", buildId: "fixture-current" } },
    "./apiOrigin": { resolvePikiApiOrigin: () => "https://api.mock.invalid" }, "./pushConsentPolicy": {},
    "./riderReleaseNetwork": { fetchRiderReleasePolicy: vi.fn() },
    "./pwaOperationSafety": { getPwaOperationSafety: () => ({ ...safety }) },
    "./pwaUpdateRecovery": { shouldDeferPwaActivation },
    "./requestDeadline": { withRequestDeadline },
    "./pikiPwaUpdate": { ...navigation,
      fetchPikiStaticRelease: vi.fn(async () => {
        beginAt("release");
        return { surface: "rider", version: "1.0.15", buildId: newBuild ? "fixture-new" : "fixture-current" };
      }),
      waitForPikiWaitingWorker: vi.fn(async () => { beginAt("waiting"); return registration.waiting; }),
      waitForPikiControllerChange: vi.fn(async () => {
        beginAt("controller-entry");
        await Promise.resolve();
        beginAt("controller");
        return true;
      }),
    },
  }, {
    window: { fetch, location: { origin: "https://mock.invalid", href: "https://mock.invalid/", reload, replace } },
    navigator, caches: cache,
    sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
  });
  const tree = component.PikiReleaseGate({ children: null });
  const update = callbacks.find((callback) => callback.toString().includes("Descargando la nueva versión"))!;
  const forceReload = callbacks.find((callback) => callback.toString().includes("getRegistrations"))!;
  expect(update).toBeDefined();
  return { tree, update, forceReload, serviceWorker, registration, postMessage, reload, replace, cache, unregister, states, safety, fetch, navigator };
}

describe("manual PWA callback — offline components, no real browser/SW", () => {
  it("always shows an update button and installed version when the build is current", () => {
    const f = fixture({ newBuild: false });
    expect(findNode(f.tree, (node) => node.tag === "button" && node.props.children === "Actualizar aplicación")).toBeDefined();
    expect(findNode(f.tree, (node) => node.tag === "aside" && node.props["aria-label"] === "Actualización de PIKI Rider")).toBeDefined();
  });
  it("keeps the current worker and caches when there is no new web build", async () => {
    const f = fixture({ newBuild: false, worker: false });
    await f.update();
    expect(f.unregister).not.toHaveBeenCalled();
    expect(f.cache.delete).not.toHaveBeenCalled();
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.states[3]).toContain("No se ha publicado un build web distinto");
  });
  it("refreshes after a worker change without unregistering the worker just activated", async () => {
    const f = fixture({ newBuild: false, worker: true });
    await f.update();
    expect(f.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(f.unregister).not.toHaveBeenCalled();
    expect(f.cache.delete).not.toHaveBeenCalled();
    expect(f.replace).toHaveBeenCalledTimes(1);
  });
  it("shows the same update control during the initial version check", () => {
    const f = fixture({ gate: "checking", newBuild: false });
    expect(findNode(f.tree, (node) => node.tag === "button" && node.props.children === "Actualizar aplicación")).toBeDefined();
  });
  it("does not clear caches or register workers while offline", async () => {
    const f = fixture({ worker: false });
    f.navigator.onLine = false;
    await f.update();
    expect(f.serviceWorker.register).not.toHaveBeenCalled();
    expect(f.cache.delete).not.toHaveBeenCalled();
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.states[3]).toContain("Sin conexión");
  });
  it("does not unregister another application's worker", async () => {
    const f = fixture({ worker: false });
    f.serviceWorker.getRegistrations.mockResolvedValue([{ ...f.registration, scope: "https://mock.invalid/another-app/" }, f.registration]);
    await f.update();
    expect(f.unregister).toHaveBeenCalledTimes(1);
  });
  it.each(["register", "update", "document"])("settles a stalled %s operation instead of leaving the button busy", async (step) => {
    vi.useFakeTimers();
    try {
      const f = fixture({ worker: false });
      if (step === "register") f.serviceWorker.register.mockImplementation(() => new Promise(() => {}));
      if (step === "update") f.registration.update.mockImplementation(() => new Promise(() => {}));
      if (step === "document") f.fetch.mockImplementation(() => new Promise(() => {}));
      const pending = f.update();
      await vi.advanceTimersByTimeAsync(10_050);
      await pending;
      expect(f.states[4]).toBe(false);
      if (step === "document") {
        expect(f.cache.delete).not.toHaveBeenCalled();
        expect(f.replace).not.toHaveBeenCalled();
      } else expect(f.replace).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("keeps caches and the session when the uncached app document cannot download", async () => {
    const f = fixture({ worker: false });
    f.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await f.update();
    expect(f.cache.delete).not.toHaveBeenCalled();
    expect(f.unregister).not.toHaveBeenCalled();
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.states[4]).toBe(false);
  });
  it("does not remove caches belonging to other applications", async () => {
    const f = fixture({ worker: false });
    await f.update();
    expect(f.cache.delete.mock.calls.map((call) => call[0])).toEqual(["piki-rider-fixture-a", "piki-rider-fixture-b"]);
  });
  it("does not launch two concurrent update transactions from repeated clicks", async () => {
    const f = fixture({ worker: false });
    await Promise.all([f.update(), f.update()]);
    expect(f.serviceWorker.register).toHaveBeenCalledTimes(1);
    expect(f.replace).toHaveBeenCalledTimes(1);
  });
  it("offers a connection retry and safe reload even when no different build is known", () => {
    const f = fixture({ gate: "error", newBuild: false });
    expect(findNode(f.tree, (node) => node.tag === "button" && node.props.children === "Reintentar conexión")).toBeDefined();
    expect(findNode(f.tree, (node) => node.tag === "button" && node.props.children === "Actualizar aplicación")).toBeDefined();
    expect(findNode(f.tree, (node) => node.tag === "aside" && node.props.className === "rider-release-status")).toBeDefined();
  });

  it("does not stack an update notice over the error notice", () => {
    const f = fixture({ gate: "error" });
    expect(findNode(f.tree, (node) => node.props.className === "rider-release-status rider-release-status--update")).toBeUndefined();
  });

  it.each(["jornada", "entrega", "checkout", "formulario"])("defers an active %s at entry", async () => {
    const f = fixture({ active: true }); await f.update();
    expect(f.serviceWorker.register).not.toHaveBeenCalled();
    expect(f.postMessage).not.toHaveBeenCalled(); expect(f.replace).not.toHaveBeenCalled();
    expect(f.cache.delete).not.toHaveBeenCalled(); expect(f.states[3]).toContain("finalice la jornada");
  });
  it("fails closed while operation safety is unknown", async () => {
    const f = fixture({ known: false }); await f.update(); expect(f.serviceWorker.register).not.toHaveBeenCalled();
  });
  it.each(["release", "register", "update", "waiting"])("defers activity starting during %s before SKIP_WAITING", async (stage) => {
    const f = fixture({ stage }); await f.update();
    expect(f.postMessage).not.toHaveBeenCalled(); expect(f.cache.delete).not.toHaveBeenCalled();
    expect(f.unregister).not.toHaveBeenCalled(); expect(f.replace).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
    expect(f.states[4]).toBe(false);
  });
  it("also checks safety immediately before SKIP_WAITING", async () => {
    const f = fixture({ stage: "controller-entry" }); await f.update();
    expect(f.postMessage).not.toHaveBeenCalled(); expect(f.replace).not.toHaveBeenCalled();
  });
  it("does not reload/navigate/clear caches if activity starts awaiting the controller", async () => {
    const f = fixture({ stage: "controller" }); await f.update();
    expect(f.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(f.replace).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
    expect(f.cache.delete).not.toHaveBeenCalled(); expect(f.unregister).not.toHaveBeenCalled();
  });
  it.each(["registrations", "unregister", "keys", "delete"])("rechecks fallback safety after %s", async (stage) => {
    const f = fixture({ stage, worker: false }); await f.update();
    expect(f.replace).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
    expect(f.postMessage).not.toHaveBeenCalled();
    expect(f.unregister).toHaveBeenCalledTimes(stage === "registrations" ? 0 : stage === "unregister" ? 1 : 2);
    expect(f.cache.delete).toHaveBeenCalledTimes(stage === "delete" ? 1 : 0);
  });
  it("guards direct fallback entry as well as the update button", async () => {
    const f = fixture({ active: true }); await f.forceReload();
    expect(f.unregister).not.toHaveBeenCalled(); expect(f.cache.keys).not.toHaveBeenCalled(); expect(f.replace).not.toHaveBeenCalled();
  });
  it("keeps a safe idle fallback usable and avoids the unguarded reload API", async () => {
    const f = fixture({ worker: false }); await f.update();
    expect(f.unregister).toHaveBeenCalledTimes(2); expect(f.cache.delete).toHaveBeenCalledTimes(2);
    expect(f.replace).toHaveBeenCalledTimes(1); expect(f.replace.mock.calls[0][0]).toContain("piki_refresh=");
    expect(f.reload).not.toHaveBeenCalled();
  });
  it("routes a successful idle controller change through the guarded navigation fallback", async () => {
    const f = fixture(); await f.update();
    expect(f.postMessage).toHaveBeenCalledTimes(1); expect(f.reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.replace).toHaveBeenCalledTimes(1));
  });
});
