import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ android: true, show: vi.fn(async (_input: unknown) => ({ scheduled: true })),
  retainOrders: vi.fn(async (_input: unknown) => {}), prepareChannels: vi.fn(async () => ({ shift: true, order: true, cancelled: true })),
  checkPermissions: vi.fn(async () => ({ display: "granted" })), requestPermissions: vi.fn(async () => ({ display: "granted" })) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.android, getPlatform: () => native.android ? "android" : "web" }, registerPlugin: () => native }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: native }));
import { queueRiderNativeAlert, retainRiderNativeOrderAlerts, requestRiderNotificationPermission, RIDER_NATIVE_CHANNELS } from "./riderNativeNotifications";
import { playRiderOrderAlert, playRiderShiftStart, playRiderOrderCancelled, primeRiderOrderAudio } from "./orderAlert";
const preferences = { alertsEnabled: true, volume: 0.7 };
beforeEach(() => { vi.clearAllMocks(); native.android = true; native.checkPermissions.mockResolvedValue({ display: "granted" }); });
afterEach(async () => { await retainRiderNativeOrderAlerts([]); vi.unstubAllGlobals(); });
describe("Android notification audio bindings", () => {
  it("binds all three WAV resources without substituting another sound", () => {
    expect(Object.values(RIDER_NATIVE_CHANNELS).map((channel) => channel.sound)).toEqual(["start_shift.wav", "new_order_rider.wav", "order_cancelled.wav"]);
  });
  it("never requests an alert without consent", async () => {
    expect(queueRiderNativeAlert("order", false)).toBe(false);
    await retainRiderNativeOrderAlerts([]); expect(native.show).not.toHaveBeenCalled();
  });
  it("rejects expired or invalid offer expiration before scheduling", () => {
    expect(queueRiderNativeAlert("order", true, "o1", new Date(Date.now() - 1).toISOString())).toBe(false);
    expect(queueRiderNativeAlert("order", true, "o1", "invalid")).toBe(false);
  });
  it("caps each finite notification and does not reprompt when OS permission is denied", async () => {
    native.checkPermissions.mockResolvedValue({ display: "denied" });
    queueRiderNativeAlert("order", true, "o1"); await retainRiderNativeOrderAlerts([]);
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
    await retainRiderNativeOrderAlerts([]);
    expect(native.show.mock.calls.map((call) => (call[0] as { kind: string }).kind)).toEqual(["shift", "order", "cancelled"]);
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
  it("only the explicit action can ask for notification permission", async () => {
    native.checkPermissions.mockResolvedValue({ display: "prompt" });
    expect(await requestRiderNotificationPermission()).toBe(true);
    expect(native.requestPermissions).toHaveBeenCalledTimes(1);
  });
});
