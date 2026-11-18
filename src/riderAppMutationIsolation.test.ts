/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { normalizeDeliveryProof, deliveryProofPayload } from "./deliveryProof";
import { compile } from "./test/offlineComponent";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name: string): string {
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!found) throw new Error(`Handler not found: ${name}`);
  return found.getText(ast);
}
function deferred<T>() {
  let resolve!: (result: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const handlerNames = ["offerAction", "confirmPickup", "confirmDelivery"] as const;
type HandlerName = typeof handlerNames[number];
function fixture(name: HandlerName) {
  const epoch = { current: 1 }, gps = { current: 1 };
  const pending = new Map<string, unknown>();
  const token = { current: "mock-only" }, rider = { current: "fixture-rider" };
  const state: Record<string, unknown> = {
    setToast: "", setOffers: [{ _id: "fixture-order", status: "ready_for_pickup", assignmentState: "assigned" }],
    setOrderActionBusy: false, setPickupRequest: null,
  };
  const setter = (name: string) => vi.fn((value: unknown) => {
    state[name] = typeof value === "function" ? value(state[name]) : value;
  });
  const setters = {
    setToast: setter("setToast"), setOffers: setter("setOffers"), setOrderActionBusy: setter("setOrderActionBusy"),
    setPickupRequest: setter("setPickupRequest"), invalidateAccountIdentity: vi.fn(),
  };
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ order: { status: "on_the_way" } }), { status: 200 }));
  const refresh = vi.fn(async () => {}), load = vi.fn(async () => {});
  const capture = vi.fn(async () => ({ latitude: 0, longitude: 0, accuracy: 1 }));
  const publish = vi.fn(async () => {});
  const run = runInNewContext(compile(`${handler(name)}\n${name};`, "mutation.ts"), {
    ...setters, riderSessionEpochRef: epoch, riderGpsSessionGenerationRef: gps,
    activeTokenRef: token, riderIdentityRef: rider,
    pendingOrderStatesRef: { current: pending }, orderActionBusy: false,
    riderId: "fixture-rider", apiToken: "mock-only", apiOrigin: "https://offline.invalid", authHeaders: () => ({}),
    window: { prompt: () => "123456" }, fetch: fetcher, Date,
    loadRiderData: load, refreshOffersRef: { current: refresh }, captureRiderGps: capture, publishRiderLocation: publish,
    normalizeDeliveryProof, deliveryProofPayload,
  }) as (id: string, argument?: string) => Promise<void>;
  const act = () => run("fixture-order", name === "offerAction" ? "on_the_way" : "123456");
  return { act, epoch, gps, token, rider, state, pending, setters, fetcher, refresh, load, capture, publish };
}
function changes(f: ReturnType<typeof fixture>) {
  return Object.fromEntries(Object.entries(f.setters).map(([name, spy]) => [name, spy.mock.calls.length]));
}

describe("App mutation isolation — extracted real handlers, no live I/O", () => {
  for (const name of handlerNames) {
    it.each(["ACK", "HTTP-error", "network-error"])(`${name} ignores late %s, including catch/finally`, async outcome => {
      const f = fixture(name), request = deferred<Response>();
      f.fetcher.mockImplementationOnce(() => request.promise);
      const work = f.act();
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
      const before = changes(f);
      f.epoch.current++;
      f.pending.set("fixture-order", { status: "new-account-state" });
      if (outcome === "network-error") request.reject(new Error("old account network error"));
      else request.resolve(new Response(JSON.stringify({ order: { status: "on_the_way" } }), { status: outcome === "ACK" ? 200 : 401 }));
      await work;
      expect(changes(f)).toEqual(before);
      expect(f.refresh).not.toHaveBeenCalled();
      expect(f.load).not.toHaveBeenCalled();
      expect(f.pending.get("fixture-order")).toEqual({ status: "new-account-state" });
    });
    it(`${name} ignores a delayed JSON body after a same-token relogin`, async () => {
      const f = fixture(name), body = deferred<unknown>();
      f.fetcher.mockResolvedValueOnce({ ok: true, status: 200, json: () => body.promise } as Response);
      const work = f.act();
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
      const before = changes(f);
      f.epoch.current++;
      body.resolve({ order: { status: "on_the_way" } });
      await work;
      expect(changes(f)).toEqual(before);
      expect(f.refresh).not.toHaveBeenCalled();
      expect(f.load).not.toHaveBeenCalled();
    });
    it(`${name} releases only its own busy state after current-session success`, async () => {
      const f = fixture(name);
      await f.act();
      expect(f.setters.setOrderActionBusy.mock.calls).toEqual([[true], [false]]);
      expect(f.fetcher).toHaveBeenCalledOnce();
      expect(f.load).toHaveBeenCalledOnce();
    });
    it(`${name} does not release a new action's busy state if account changes while reloading`, async () => {
      const f = fixture(name), reload = deferred<void>();
      f.load.mockImplementationOnce(() => reload.promise);
      const work = f.act();
      await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce());
      const before = changes(f);
      f.epoch.current++;
      reload.resolve();
      await work;
      expect(changes(f)).toEqual(before);
      expect(f.setters.setOrderActionBusy).not.toHaveBeenCalledWith(false);
    });
  }
  it.each(["resolve", "reject"])("delivery ignores a late GPS %s without a POST or error toast", async outcome => {
    const f = fixture("confirmDelivery"), capture = deferred<{ latitude: number; longitude: number; accuracy: number }>();
    f.capture.mockImplementationOnce(() => capture.promise);
    const work = f.act();
    const before = changes(f);
    f.epoch.current++;
    if (outcome === "resolve") capture.resolve({ latitude: 0, longitude: 0, accuracy: 1 });
    else capture.reject(new Error("old GPS error"));
    await work;
    expect(changes(f)).toEqual(before);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });
  it.each([200, 422, "network"] as const)("pickup stops after a late offers refresh for %s", async outcome => {
    const f = fixture("confirmPickup"), refresh = deferred<void>();
    f.refresh.mockImplementationOnce(() => refresh.promise);
    if (outcome === "network") f.fetcher.mockRejectedValueOnce(new Error("fixture timeout"));
    else f.fetcher.mockResolvedValueOnce(new Response("{}", { status: outcome }));
    const work = f.act();
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledOnce());
    const before = changes(f);
    f.epoch.current++;
    refresh.resolve();
    await work;
    expect(changes(f)).toEqual(before);
    expect(f.load).not.toHaveBeenCalled();
  });
  it("pickup rechecks the epoch after authoritative reload before reapplying the immediate mutation ACK", async () => {
    const f = fixture("confirmPickup"), load = deferred<void>();
    f.load.mockImplementationOnce(() => load.promise);
    const work = f.act();
    await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce());
    const before = changes(f);
    f.epoch.current++;
    load.resolve();
    await work;
    expect(changes(f)).toEqual(before);
  });
  it("the real scoped reset clears optimistic order transitions and pending pickup state", () => {
    let reset: ts.VariableDeclaration | undefined;
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "resetRiderScopedState") reset = node;
      ts.forEachChild(node, visit);
    }
    visit(ast);
    const pending = new Map([["fixture-order", { status: "on_the_way" }]]);
    const code = `const ${reset!.getText(ast)};\nresetRiderScopedState();`;
    const pickup = vi.fn();
    const globals: Record<string, unknown> = {
      useCallback: (fn: unknown) => fn, pendingOrderStatesRef: { current: pending },
      riderArrivalAlerts: { reset: vi.fn() }, riderShiftSyncRef: { current: { reset: vi.fn() } },
      cancelledOrderIdsRef: { current: new Set() }, defaultRiderAudioPreferences: {},
    };
    for (const name of new Set([...code.matchAll(/\b([a-zA-Z]\w*Ref)\.current/g)].map(match => match[1]))) {
      if (!(name in globals)) globals[name] = { current: null };
    }
    for (const name of new Set([...code.matchAll(/\b([a-zA-Z]\w*)\(/g)].map(match => match[1]))) {
      if (!(name in globals) && name !== "resetRiderScopedState") globals[name] = vi.fn();
    }
    globals.setPickupRequest = pickup;
    runInNewContext(compile(code, "reset.ts"), globals);
    expect(pending.size).toBe(0);
    expect(pickup).toHaveBeenCalledExactlyOnceWith(null);
  });
});

type OwnershipChange = "rider-only" | "rider-and-GPS" | "token-only" | "GPS-only";
function changeOwnership(f: ReturnType<typeof fixture>, change: OwnershipChange) {
  if (change.startsWith("rider")) f.rider.current = "fixture-rider-B";
  if (change === "token-only") f.token.current = "mock-only-B";
  if (change === "rider-and-GPS" || change === "GPS-only") f.gps.current++;
  // Simulate B's already-rendered UI/new in-flight action, including a colliding
  // order id. Setters consume functional updates so stale mutations are visible.
  f.state.setToast = "B's notice";
  f.state.setOffers = [{ _id: "fixture-order", status: "ready_for_pickup", assignmentState: "assigned", owner: "B" }];
  f.state.setOrderActionBusy = true;
  f.state.setPickupRequest = { orderId: "fixture-order", status: "sending", owner: "B" };
  f.pending.set("fixture-order", { status: "B's transition" });
}
function snapshot(f: ReturnType<typeof fixture>) {
  return JSON.stringify({ state: f.state, pending: [...f.pending], changes: changes(f) });
}

describe("App mutations retain captured ownership even when the token/epoch are unchanged", () => {
  for (const name of handlerNames) {
    const ownershipChanges: OwnershipChange[] = ["rider-only", "rider-and-GPS", "token-only"];
    if (name === "confirmDelivery") ownershipChanges.push("GPS-only");
    for (const change of ownershipChanges) {
      it.each(["ACK", "HTTP-error", "network-error", "body"])(`${name}: ${change} ignores late %s and preserves B's whole UI`, async outcome => {
        const f = fixture(name), request = deferred<Response>(), body = deferred<unknown>();
        if (outcome === "body") f.fetcher.mockResolvedValueOnce({ ok: true, status: 200, json: () => body.promise } as Response);
        else f.fetcher.mockImplementationOnce(() => request.promise);
        const work = f.act();
        await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
        changeOwnership(f, change);
        const before = snapshot(f);
        if (outcome === "network-error") request.reject(new Error("A's late network failure"));
        else if (outcome === "body") body.resolve({ order: { status: "on_the_way" }, message: "A's ACK" });
        else request.resolve(new Response(JSON.stringify({ order: { status: "on_the_way" }, message: "A's result" }), { status: outcome === "ACK" ? 200 : 401 }));
        await work;
        expect(snapshot(f)).toBe(before);
        expect(f.epoch.current).toBe(1); // Never manually advance the epoch.
        if (change !== "token-only") expect(f.token.current).toBe("mock-only");
        expect(f.refresh).not.toHaveBeenCalled();
        expect(f.load).not.toHaveBeenCalled();
      });
      it(`${name}: ${change} cannot release busy or reapply an ACK after a late reload`, async () => {
        const f = fixture(name), reload = deferred<void>();
        f.load.mockImplementationOnce(() => reload.promise);
        const work = f.act();
        await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce());
        changeOwnership(f, change);
        const before = snapshot(f);
        reload.resolve();
        await work;
        expect(snapshot(f)).toBe(before);
        expect(f.epoch.current).toBe(1);
      });
    }
  }
  it.each([200, 422, "network"] as const)("pickup stops after B's rider-only rebind during offers refresh (%s)", async outcome => {
    const f = fixture("confirmPickup"), refresh = deferred<void>();
    f.refresh.mockImplementationOnce(() => refresh.promise);
    if (outcome === "network") f.fetcher.mockRejectedValueOnce(new Error("A's timeout"));
    else f.fetcher.mockResolvedValueOnce(new Response("{}", { status: outcome }));
    const work = f.act();
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledOnce());
    changeOwnership(f, "rider-only");
    const before = snapshot(f);
    refresh.resolve();
    await work;
    expect(snapshot(f)).toBe(before);
    expect(f.load).not.toHaveBeenCalled();
    expect(f.epoch.current).toBe(1);
    expect(f.token.current).toBe("mock-only");
  });
  for (const stage of ["capture", "publish"] as const) {
    it.each(["resolve", "reject"])(`delivery stops after rider-only rebind during GPS ${stage} %s`, async outcome => {
      const f = fixture("confirmDelivery");
      const capture = deferred<{ latitude: number; longitude: number; accuracy: number }>(), publish = deferred<void>();
      if (stage === "capture") f.capture.mockImplementationOnce(() => capture.promise);
      else f.publish.mockImplementationOnce(() => publish.promise);
      const work = f.act();
      await vi.waitFor(() => expect(stage === "capture" ? f.capture : f.publish).toHaveBeenCalledOnce());
      changeOwnership(f, "rider-only");
      const before = snapshot(f);
      if (stage === "capture") {
        if (outcome === "reject") capture.reject(new Error("A's GPS error"));
        else capture.resolve({ latitude: 0, longitude: 0, accuracy: 1 });
      } else if (outcome === "reject") publish.reject(new Error("A's location publish error"));
      else publish.resolve();
      await work;
      expect(snapshot(f)).toBe(before);
      expect(f.fetcher).not.toHaveBeenCalled();
      if (stage === "capture") expect(f.publish).not.toHaveBeenCalled();
      expect(f.epoch.current).toBe(1);
      expect(f.token.current).toBe("mock-only");
    });
  }
});
