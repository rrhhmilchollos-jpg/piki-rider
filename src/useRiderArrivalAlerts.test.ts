import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiderGpsSnapshot } from "./riderGpsTracker";
const state = vi.hoisted(() => ({ android: true, gps: { state: "waiting", detail: "fixture" } as RiderGpsSnapshot,
  effects: [] as (() => void | (() => void))[], queue: vi.fn(), retain: vi.fn() }));
vi.mock("react", () => ({ useState: (create: () => unknown) => [create(), vi.fn()],
  useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); } }));
vi.mock("./riderGpsNative", () => ({ usesAndroidGps: () => state.android }));
vi.mock("./riderGpsState", () => ({ getRiderGpsSnapshot: () => state.gps, useRiderGpsSnapshot: () => state.gps }));
vi.mock("./riderNativeNotifications", () => ({ queueRiderNativeAlert: state.queue, retainRiderNativeArrivalAlerts: state.retain }));
import { useRiderArrivalAlerts } from "./useRiderArrivalAlerts";
import { riderArrivalKey } from "./riderArrivalAlerts";
import { RIDER_GPS_STOP_EVENT } from "./riderGpsSession";
const start = 1_000_000;
const order = { _id: "fixture-order", assignmentState: "assigned" as const, status: "preparing" as const,
  restaurant: { location: { type: "Point", coordinates: [0, 0] } } };
const input = { riderId: "fixture-rider", order, enabled: true, consent: true, isOrderCancelled: () => false };
let target: EventTarget;
let stored: Map<string, string>;
let cleanup: (() => void)[];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(start); vi.clearAllMocks(); state.android = true;
  state.gps = { state: "waiting", detail: "fixture" }; state.effects = []; cleanup = [];
  target = new EventTarget(); vi.stubGlobal("window", target);
  stored = new Map(); vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); },
  });
});
afterEach(() => { for (const done of cleanup) done(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function mount(next = input) {
  // oxlint-disable-next-line react-hooks/rules-of-hooks -- React is mocked above; this runs captured local effects, not a mounted UI.
  const c = useRiderArrivalAlerts(next);
  for (const effect of state.effects.splice(0)) { const done = effect(); if (done) cleanup.push(done); }
  return c;
}
function fix(at: number, latitude: number): RiderGpsSnapshot {
  return { state: "tracking", detail: "fixture", lastFixAt: at, lastAckAt: at + 1,
    lastAcknowledgedFix: { latitude, longitude: 0, accuracy: 5, timestamp: at } };
}
function arrive(c: ReturnType<typeof mount>) {
  state.gps = fix(start + 10, 0.001); c.observe(state.gps, start + 12);
  state.gps = fix(start + 20, 0); c.observe(state.gps, start + 22);
  vi.setSystemTime(start + 22);
}
describe("arrival hook wiring — mocked local effects only", () => {
  it("uses the native snapshot and stores only consumed rider/order/phase markers", () => {
    const c = mount(); arrive(c);
    expect(state.queue).toHaveBeenCalledTimes(1);
    const [kind, consent, key, expiry, isCurrent] = state.queue.mock.calls[0];
    expect(kind).toBe("arrived_store"); expect(consent).toBe(true);
    expect(key).toBe(riderArrivalKey("fixture-rider", order._id, "arrived_store"));
    expect(Date.parse(expiry)).toBe(start + 20 + 15_000);
    expect(isCurrent()).toBe(true);
    expect([...stored.entries()]).toEqual([[key, "consumed"]]);
    state.gps = { state: "error", detail: "fixture" }; expect(isCurrent()).toBe(false);
  });
  it("never generates arrival notifications on a WebView/browser provider", () => {
    state.android = false; const c = mount(); arrive(c); expect(state.queue).not.toHaveBeenCalled();
  });
  it("does not bind a cancelled order preserved in a stale offers snapshot", () => {
    const c = mount({ ...input, isOrderCancelled: () => true }); arrive(c);
    expect(state.queue).not.toHaveBeenCalled();
  });
  it.each(["online", RIDER_GPS_STOP_EVENT])("synchronously clears active state/queued guards on %s", (event) => {
    const c = mount(); arrive(c);
    const isCurrent = state.queue.mock.calls[0][4] as () => boolean; expect(isCurrent()).toBe(true);
    target.dispatchEvent(new Event(event));
    expect(isCurrent()).toBe(false); expect(state.retain).toHaveBeenLastCalledWith([]);
    c.observe(fix(start + 30, 0), start + 32); expect(state.queue).toHaveBeenCalledTimes(1);
  });
  it("does not notify when persistent dedupe storage is inaccessible", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("fixture denied"); }, setItem() { throw new Error("fixture denied"); } });
    const c = mount(); arrive(c); expect(state.queue).not.toHaveBeenCalled();
  });
  it("invalidates sound and removes its event listeners on unmount", () => {
    const c = mount(); arrive(c);
    const isCurrent = state.queue.mock.calls[0][4] as () => boolean;
    for (const done of cleanup.splice(0)) done();
    expect(isCurrent()).toBe(false);
    state.retain.mockClear(); target.dispatchEvent(new Event("online")); expect(state.retain).not.toHaveBeenCalled();
  });
});
