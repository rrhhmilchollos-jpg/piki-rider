/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import * as navigation from "./pikiPwaUpdate";
import { shouldDeferPwaActivation } from "./pwaUpdateRecovery";
import { jsx, loadComponent } from "./test/offlineComponent";

function fixture({ active = false, known = true, stage = "", worker = true } = {}) {
  const safety = { known, active };
  const beginAt = (at: string) => { if (stage === at) safety.active = true; };
  const postMessage = vi.fn();
  const reload = vi.fn();
  const replace = vi.fn();
  const unregister = vi.fn(async () => { beginAt("unregister"); return true; });
  const registration = { waiting: worker ? { postMessage } : null,
    update: vi.fn(async () => { beginAt("update"); }), unregister };
  const serviceWorker = {
    controller: null,
    register: vi.fn(async () => { beginAt("register"); return registration; }),
    getRegistrations: vi.fn(async () => { beginAt("registrations"); return [registration, { unregister }]; }),
  };
  const cache = {
    keys: vi.fn(async () => { beginAt("keys"); return ["fixture-a", "fixture-b"]; }),
    delete: vi.fn(async () => { beginAt("delete"); return true; }),
  };
  const states: unknown[] = ["ready", "", "1.0.15 · fixture-new", "", false, false];
  let index = 0;
  const callbacks: (() => Promise<void>)[] = [];
  const component = loadComponent("src/pikiRelease.tsx", {
    react: {
      useState: () => { const slot = index++; return [states[slot], (value: unknown) => { states[slot] = value; }]; },
      useRef: (value: unknown) => ({ current: value }), useEffect: () => {},
      useCallback: (callback: () => Promise<void>) => { callbacks.push(callback); return callback; },
    },
    "react/jsx-runtime": jsx, "@capacitor/core": { Capacitor: { isNativePlatform: () => false } },
    "./release-meta": { PIKI_RELEASE: { surface: "rider", version: "1.0.15", buildId: "fixture-current" } },
    "./apiOrigin": { resolvePikiApiOrigin: () => "https://api.mock.invalid" }, "./pushConsentPolicy": {},
    "./pwaOperationSafety": { getPwaOperationSafety: () => ({ ...safety }) },
    "./pwaUpdateRecovery": { shouldDeferPwaActivation },
    "./pikiPwaUpdate": { ...navigation,
      waitForPikiWaitingWorker: vi.fn(async () => { beginAt("waiting"); return registration.waiting; }),
      waitForPikiControllerChange: vi.fn(async () => {
        beginAt("controller-entry");
        await Promise.resolve();
        beginAt("controller");
        return true;
      }),
    },
  }, {
    window: { location: { origin: "https://mock.invalid", href: "https://mock.invalid/", reload, replace } },
    navigator: { onLine: true, serviceWorker }, caches: cache,
    sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
  });
  component.PikiReleaseGate({ children: null });
  const update = callbacks.find((callback) => callback.toString().includes("Descargando la nueva versión"))!;
  const forceReload = callbacks.find((callback) => callback.toString().includes("getRegistrations"))!;
  expect(update).toBeDefined();
  return { update, forceReload, serviceWorker, registration, postMessage, reload, replace, cache, unregister, states, safety };
}

describe("manual PWA callback — offline components, no real browser/SW", () => {
  it.each(["jornada", "entrega", "checkout", "formulario"])("defers an active %s at entry", async () => {
    const f = fixture({ active: true }); await f.update();
    expect(f.serviceWorker.register).not.toHaveBeenCalled();
    expect(f.postMessage).not.toHaveBeenCalled(); expect(f.replace).not.toHaveBeenCalled();
    expect(f.cache.delete).not.toHaveBeenCalled(); expect(f.states[3]).toContain("finalice la jornada");
  });
  it("fails closed while operation safety is unknown", async () => {
    const f = fixture({ known: false }); await f.update(); expect(f.serviceWorker.register).not.toHaveBeenCalled();
  });
  it.each(["register", "update", "waiting"])("defers activity starting during %s before SKIP_WAITING", async (stage) => {
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
