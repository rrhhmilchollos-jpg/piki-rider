import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ android: true, show: vi.fn(async (_input: unknown) => ({ scheduled: true })),
  retainOrders: vi.fn(async (_input: unknown) => {}), retainArrivals: vi.fn(async (_input: unknown) => {}), clearAlerts: vi.fn(async () => {}),
  prepareChannels: vi.fn(async () => ({ shift: true, order: true, cancelled: true, arrived_store: true, arrived_customer: true })),
  checkPermissions: vi.fn(async () => ({ display: "granted" })), requestPermissions: vi.fn(async () => ({ display: "granted" })) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.android, getPlatform: () => native.android ? "android" : "web" }, registerPlugin: () => native }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: native }));
import { queueRiderNativeAlert, retainRiderNativeOrderAlerts, retainRiderNativeArrivalAlerts, clearRiderNativeAlerts,
  prepareRiderNativeChannels, requestRiderNotificationPermission, RIDER_NATIVE_CHANNELS } from "./riderNativeNotifications";
import { playRiderOrderAlert, playRiderShiftStart, playRiderOrderCancelled, primeRiderOrderAudio } from "./orderAlert";
const preferences = { alertsEnabled: true, volume: 0.7 };
beforeEach(() => { vi.clearAllMocks(); native.android = true; native.checkPermissions.mockResolvedValue({ display: "granted" }); });
afterEach(async () => { await retainRiderNativeOrderAlerts([]); await retainRiderNativeArrivalAlerts([]); vi.unstubAllGlobals(); });
describe("Android notification audio bindings", () => {
  it("binds the five supplied WAV resources without substituting another sound", () => {
    expect(Object.values(RIDER_NATIVE_CHANNELS).map((channel) => channel.sound)).toEqual([
      "start_shift.wav", "new_order_rider.wav", "order_cancelled.wav", "arrived_store.wav", "arrived_customer.wav",
    ]);
    expect(RIDER_NATIVE_CHANNELS.arrived_store.id).toBe("piki_arrived_store");
    expect(RIDER_NATIVE_CHANNELS.arrived_customer.id).toBe("piki_arrived_customer");
  });
  it("prepares all five channels and remains inert on web", async () => {
    expect(await prepareRiderNativeChannels()).toMatchObject({ arrived_store: true, arrived_customer: true });
    native.android = false;
    expect(await prepareRiderNativeChannels()).toMatchObject({ arrived_store: false, arrived_customer: false });
    expect(queueRiderNativeAlert("arrived_store", true)).toBe(false);
  });
  it.each(["order", "arrived_store", "arrived_customer"] as const)("never requests %s without consent", async (kind) => {
    expect(queueRiderNativeAlert(kind, false)).toBe(false);
    await retainRiderNativeOrderAlerts([]); expect(native.show).not.toHaveBeenCalled();
  });
  it("rejects expired or invalid offer expiration before scheduling", () => {
    expect(queueRiderNativeAlert("order", true, "o1", new Date(Date.now() - 1).toISOString())).toBe(false);
    expect(queueRiderNativeAlert("order", true, "o1", "invalid")).toBe(false);
  });
  it.each(["order", "arrived_store", "arrived_customer"] as const)("does not reprompt %s when OS permission is denied", async (kind) => {
    native.checkPermissions.mockResolvedValue({ display: "denied" });
    queueRiderNativeAlert(kind, true, "o1"); await retainRiderNativeOrderAlerts([]);
    expect(native.show).not.toHaveBeenCalled(); expect(native.requestPermissions).not.toHaveBeenCalled();
  });
  it("native foreground routes never use multimedia or navigator vibration", async () => {
    const Audio = vi.fn(); const AudioContext = vi.fn(); const vibrate = vi.fn();
    vi.stubGlobal("Audio", Audio); vi.stubGlobal("window", { AudioContext }); vi.stubGlobal("navigator", { vibrate });
    const ref = { current: null };
    expect(primeRiderOrderAudio(ref, preferences)).toBeNull();
    expect(playRiderShiftStart(preferences)).toBe(true);
    expect(playRiderOrderAlert(ref, preferences, undefined, { id: "o1" }).vibrationRequested).toBe(false);
    expect(playRiderOrderCancelled(preferences, "o1")).toBe(true);
    queueRiderNativeAlert("arrived_store", true, "fixture:store");
    queueRiderNativeAlert("arrived_customer", true, "fixture:customer");
    await retainRiderNativeOrderAlerts([]);
    expect(native.show.mock.calls.map((call) => (call[0] as { kind: string }).kind)).toEqual([
      "shift", "order", "cancelled", "arrived_store", "arrived_customer",
    ]);
    expect(Audio).not.toHaveBeenCalled(); expect(AudioContext).not.toHaveBeenCalled(); expect(vibrate).not.toHaveBeenCalled();
    for (const call of native.show.mock.calls) expect((call[0] as { expiresAt: number }).expiresAt - Date.now()).toBeLessThanOrEqual(15000);
  });
  it("queues cancellation after a pending show, never before it", async () => {
    const calls: string[] = [];
    native.show.mockImplementationOnce(async () => { calls.push("show"); return { scheduled: true }; });
    native.retainOrders.mockImplementationOnce(async () => { calls.push("cancel"); });
    queueRiderNativeAlert("order", true, "o1"); await retainRiderNativeOrderAlerts([]);
    expect(calls).toEqual(["show", "cancel"]);
  });
  it("keeps arrivals in a separate ID range and retention set from offers", async () => {
    queueRiderNativeAlert("order", true, "same-key"); queueRiderNativeAlert("arrived_store", true, "same-key");
    await retainRiderNativeArrivalAlerts(["same-key"]); await retainRiderNativeOrderAlerts([]);
    const ids = native.show.mock.calls.map(([input]) => (input as { id: number }).id);
    expect(ids[0]).toBeLessThan(920000); expect(ids[1]).toBeGreaterThanOrEqual(920000);
    expect(native.retainArrivals).toHaveBeenCalledWith({ ids: [ids[1]] });
    expect(native.retainOrders).toHaveBeenCalledWith({ ids: [] });
  });
  it("invalidates a queued arrival while its permission check is pending", async () => {
    let resolve!: (value: { display: string }) => void;
    const permission = new Promise<{ display: string }>((done) => { resolve = done; });
    native.checkPermissions.mockImplementationOnce(() => permission);
    let current = true;
    queueRiderNativeAlert("arrived_store", true, "fixture:store", undefined, () => current);
    await Promise.resolve(); await Promise.resolve();
    current = false; resolve({ display: "granted" });
    await retainRiderNativeArrivalAlerts([]);
    expect(native.show).not.toHaveBeenCalled();
  });
  it("clears an already in-flight show after native completion on logout/consent revocation", async () => {
    const calls: string[] = [];
    let resolve!: (value: { scheduled: boolean }) => void;
    native.show.mockImplementationOnce(() => { calls.push("show"); return new Promise((done) => { resolve = done; }); });
    native.clearAlerts.mockImplementationOnce(async () => { calls.push("clear"); });
    queueRiderNativeAlert("arrived_customer", true, "fixture:customer");
    for (let i = 0; i < 10 && !resolve; i++) await Promise.resolve();
    const cleared = clearRiderNativeAlerts();
    resolve({ scheduled: true }); await cleared;
    expect(calls).toEqual(["show", "clear"]);
  });
  it("only the explicit action can ask for notification permission", async () => {
    native.checkPermissions.mockResolvedValue({ display: "prompt" });
    expect(await requestRiderNotificationPermission()).toBe(true);
    expect(native.requestPermissions).toHaveBeenCalledTimes(1);
  });
});
