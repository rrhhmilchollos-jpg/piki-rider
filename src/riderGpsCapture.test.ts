import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Location } from "@capacitor-community/background-geolocation";
const native = vi.hoisted(() => ({ android: true, addWatcher: vi.fn(), removeWatcher: vi.fn(async () => {}) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.android, getPlatform: () => native.android ? "android" : "web" }, registerPlugin: () => native }));
import { captureRiderGps } from "./riderGpsCapture";
import { RIDER_GPS_STOP_EVENT } from "./riderGpsSession";
let callback: (location?: Location, error?: Error) => void;
const location = (patch: Partial<Location> = {}): Location => ({ latitude: 38.9, longitude: -0.5, accuracy: 8,
  altitude: null, altitudeAccuracy: null, simulated: false, bearing: 95, speed: null, time: Date.now(), ...patch });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T00:00:00Z")); vi.clearAllMocks();
  native.android = true; native.addWatcher.mockImplementation(async (_options, cb) => { callback = cb; return "capture-1"; });
  vi.stubGlobal("document", { visibilityState: "visible" }); vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("one-shot native GPS", () => {
  it("requests no background tracking and removes the fresh watcher", async () => {
    const pending = captureRiderGps(); await vi.advanceTimersByTimeAsync(0); callback(location());
    expect(await pending).toMatchObject({ latitude: 38.9, timestamp: Date.now(), heading: 95 });
    expect(native.addWatcher.mock.calls[0][0]).toEqual({ requestPermissions: true, stale: false, distanceFilter: 0 });
    expect(native.removeWatcher).toHaveBeenCalledWith({ id: "capture-1" });
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
  it("ignores cached, missing and future provider timestamps", async () => {
    const pending = captureRiderGps(); await vi.advanceTimersByTimeAsync(0);
    callback(location({ time: Date.now() - 1 })); callback(location({ time: null })); callback(location({ time: Date.now() + 1 }));
    expect(native.removeWatcher).not.toHaveBeenCalled(); callback(location()); await pending;
    expect(native.removeWatcher).toHaveBeenCalledTimes(1);
  });
  it("rejects simulated positions and removes the watcher", async () => {
    const pending = captureRiderGps(); const rejected = expect(pending).rejects.toThrow("simulada");
    await vi.advanceTimersByTimeAsync(0); callback(location({ simulated: true })); await rejected;
    expect(native.removeWatcher).toHaveBeenCalledTimes(1);
  });
  it("timeout removes the watcher and ignores late callbacks", async () => {
    const pending = captureRiderGps(1000); const rejected = expect(pending).rejects.toThrow("tiempo");
    await vi.advanceTimersByTimeAsync(1000); await rejected; callback(location());
    expect(native.removeWatcher).toHaveBeenCalledTimes(1);
  });
  it("session/GPS stop cancels capture immediately", async () => {
    const pending = captureRiderGps(); const rejected = expect(pending).rejects.toThrow("cancelada");
    await vi.advanceTimersByTimeAsync(0); window.dispatchEvent(new Event(RIDER_GPS_STOP_EVENT)); await rejected;
    expect(native.removeWatcher).toHaveBeenCalledTimes(1);
  });
  it("does not request GPS while hidden", async () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    await expect(captureRiderGps()).rejects.toThrow("Abre PIKI"); expect(native.addWatcher).not.toHaveBeenCalled();
  });
});
