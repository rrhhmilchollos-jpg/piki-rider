import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallbackError, Location, WatcherOptions } from "@capacitor-community/background-geolocation";
import { createRiderGpsTracker } from "./riderGpsNative";
import type { RiderGpsSnapshot, RiderGpsTracker } from "./riderGpsTracker";

const native = vi.hoisted(() => ({
  android: false,
  addWatcher: vi.fn(),
  removeWatcher: vi.fn(async () => {}),
  post: vi.fn(async (_input: unknown): Promise<{ status: number; data?: unknown }> => ({ status: 200 })),
  checkPermissions: vi.fn(async () => ({ display: "granted" })),
  requestPermissions: vi.fn(async () => ({ display: "granted" })),
  event: vi.fn(async () => {}),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.android, getPlatform: () => native.android ? "android" : "web" },
  CapacitorHttp: { post: native.post },
  registerPlugin: (name: string) => name === "BackgroundGeolocation" ? native : { event: native.event },
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: native }));

class VisibilityDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
type CapturedPosition = { success: PositionCallback; error: PositionErrorCallback };
const coords = { latitude: 38.989, longitude: -0.52, accuracy: 8 };
function position(timestamp = Date.now()): GeolocationPosition {
  return { timestamp, coords: { ...coords, heading: null, speed: null, altitude: null, altitudeAccuracy: null } } as GeolocationPosition;
}
function location(time: number | null = Date.now()): Location {
  return { ...coords, time, altitude: null, altitudeAccuracy: null, simulated: false, bearing: null, speed: null };
}
function error(code: number): GeolocationPositionError {
  return { code, message: "GPS mock" } as GeolocationPositionError;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let documentMock: VisibilityDocument;
let watches: CapturedPosition[];
let requests: CapturedPosition[];
let liveWatches: Set<number>;
let geolocation: { watchPosition: ReturnType<typeof vi.fn>; clearWatch: ReturnType<typeof vi.fn>; getCurrentPosition: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;
let trackers: RiderGpsTracker[];
let nativeCallbacks: ((location?: Location, error?: CallbackError) => void)[];
const settle = () => vi.advanceTimersByTimeAsync(0);
function fixture() {
  const states: RiderGpsSnapshot[] = [];
  const onFix = vi.fn();
  const tracker = createRiderGpsTracker("https://gps.invalid", "mock-token", "rider-1", (state) => states.push(state), onFix);
  trackers.push(tracker);
  return { tracker, states, onFix, latest: () => states.at(-1)! };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
  vi.clearAllMocks();
  native.android = false;
  native.post.mockResolvedValue({ status: 200 });
  native.checkPermissions.mockResolvedValue({ display: "granted" });
  native.requestPermissions.mockResolvedValue({ display: "granted" });
  watches = [];
  requests = [];
  liveWatches = new Set();
  trackers = [];
  nativeCallbacks = [];
  native.addWatcher.mockImplementation(async (_options: WatcherOptions, callback: (location?: Location, error?: CallbackError) => void) => {
    nativeCallbacks.push(callback);
    return `native-${nativeCallbacks.length}`;
  });
  documentMock = new VisibilityDocument();
  geolocation = {
    watchPosition: vi.fn((success: PositionCallback, fail: PositionErrorCallback) => {
      watches.push({ success, error: fail });
      liveWatches.add(watches.length);
      return watches.length;
    }),
    clearWatch: vi.fn((id: number) => { liveWatches.delete(id); }),
    getCurrentPosition: vi.fn((success: PositionCallback, fail: PositionErrorCallback) => { requests.push({ success, error: fail }); }),
  };
  fetchMock = vi.fn(async () => ({ status: 200 }));
  vi.stubGlobal("document", documentMock);
  vi.stubGlobal("navigator", { geolocation });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  trackers.forEach((tracker) => tracker.stop());
  await settle();
  // Even a deliberately hung navigator request must settle to release the
  // cross-session guard; removed callbacks cannot update state or publish.
  requests.forEach((request) => request.success(position()));
  await settle();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Visible browser stationary GPS", () => {
  it("keeps the provider timestamp and requires a real HTTP acknowledgement", async () => {
    const sent = deferred<{ status: number }>();
    fetchMock.mockImplementation(() => sent.promise);
    const f = fixture();
    await f.tracker.start();
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(geolocation.watchPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    const capturedAt = Date.now() - 123;
    watches[0].success(position(capturedAt));
    expect(f.latest().lastFixAt).toBe(capturedAt);
    expect(f.latest().lastAckAt).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(coords);
    await vi.advanceTimersByTimeAsync(2_000);
    sent.resolve({ status: 200 });
    await settle();
    expect(f.latest().state).toBe("tracking");
    expect(f.latest().lastAckAt).toBe(Date.now());
    expect(f.latest().lastFixAt).toBe(capturedAt);
  });

  it("requests a NEW stationary fix every 30 s but publishes only at 60 s, not on timer ticks", async () => {
    const sent = deferred<{ status: number }>();
    fetchMock.mockImplementationOnce(() => sent.promise);
    const f = fixture();
    await f.tracker.start();
    watches[0].success(position());
    await vi.advanceTimersByTimeAsync(2_000);
    sent.resolve({ status: 200 });
    await settle();
    await vi.advanceTimersByTimeAsync(28_000);
    expect(geolocation.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
    requests[0].success(position());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstAck = f.latest().lastAckAt;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(f.latest().lastAckAt).toBe(firstAck);
    requests[1].success(position());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(f.latest().lastAckAt).toBe(Date.now());
    const realAck = f.latest().lastAckAt;
    const realFix = f.latest().lastFixAt;
    await vi.advanceTimersByTimeAsync(120_000);
    // The third capture is deliberately unresolved: no duplicate request,
    // no reused coordinates, no invented lastFixAt/ACK despite more ticks.
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(f.latest().lastAckAt).toBe(realAck);
    expect(f.latest().lastFixAt).toBe(realFix);
  });

  it("rejects cached, duplicate and future fixes without relabelling them", async () => {
    const f = fixture();
    await f.tracker.start();
    const initial = position();
    watches[0].success(initial);
    await settle();
    const ack = f.latest().lastAckAt;
    await vi.advanceTimersByTimeAsync(30_000);
    requests[0].success(initial); // cached before getCurrentPosition was requested
    watches[0].success(initial); // repeated provider timestamp
    watches[0].success(position(Date.now() + 1_000));
    watches[0].success(position(Date.now() - 15_001));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(f.latest().lastFixAt).toBe(initial.timestamp);
    expect(f.latest().lastAckAt).toBe(ack);
    await vi.advanceTimersByTimeAsync(30_000);
    requests[1].success(position());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never starts or requests GPS while the PWA is hidden", async () => {
    documentMock.setVisibility("hidden");
    const f = fixture();
    await f.tracker.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    documentMock.setVisibility("visible");
    await f.tracker.resume();
    expect(liveWatches.size).toBe(1);
  });

  it("clears timers/watchers on hide and ignores callbacks crossing hide/show without overlapping requests", async () => {
    const f = fixture();
    await f.tracker.start();
    await vi.advanceTimersByTimeAsync(30_000);
    documentMock.setVisibility("hidden");
    expect(liveWatches.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    watches[0].success(position());
    await vi.advanceTimersByTimeAsync(90_000);
    expect(requests).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    documentMock.setVisibility("visible");
    documentMock.setVisibility("visible");
    expect(liveWatches.size).toBe(1);
    expect(watches).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests).toHaveLength(1); // old request is still outstanding
    requests[0].success(position()); // current timestamp, but obsolete visibility generation
    watches[0].success(position());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    requests[1].success(position());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("removes timer/listener/watcher and ignores pending fixes and HTTP ACKs after stop", async () => {
    const sent = deferred<{ status: number }>();
    fetchMock.mockImplementation(() => sent.promise);
    const f = fixture();
    await f.tracker.start();
    watches[0].success(position());
    await vi.advanceTimersByTimeAsync(30_000);
    f.tracker.stop();
    await settle();
    const count = f.states.length;
    expect(liveWatches.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    requests[0].success(position());
    watches[0].success(position());
    sent.resolve({ status: 200 });
    documentMock.setVisibility("hidden");
    documentMock.setVisibility("visible");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(watches).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(f.states).toHaveLength(count);
    expect(f.latest().lastAckAt).toBeUndefined();
  });

  it("does not overlap a pending request when explicitly restarting the tracker", async () => {
    const f = fixture();
    await f.tracker.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await f.tracker.start();
    expect(liveWatches.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests).toHaveLength(1);
    requests[0].success(position());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    requests[1].success(position());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers from a capture timeout only with a new real fix and keeps one watcher", async () => {
    const f = fixture();
    await f.tracker.start();
    watches[0].success(position());
    await settle();
    const ack = f.latest().lastAckAt;
    await vi.advanceTimersByTimeAsync(30_000);
    requests[0].error(error(3));
    await settle();
    expect(f.latest().state).toBe("error");
    expect(f.latest().lastAckAt).toBe(ack);
    expect(liveWatches.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    requests[1].success(position());
    await settle();
    expect(f.latest().state).toBe("tracking");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(watches).toHaveLength(1);
  });

  it.each(["watcher", "request", "hidden request"])("treats denied permission from %s as terminal", async (source) => {
    const f = fixture();
    await f.tracker.start();
    if (source !== "watcher") await vi.advanceTimersByTimeAsync(30_000);
    if (source === "hidden request") documentMock.setVisibility("hidden");
    (source === "watcher" ? watches[0] : requests[0]).error(error(1));
    await settle();
    expect(f.latest().state).toBe("error");
    expect(f.latest().autoRetryAllowed).toBe(false);
    expect(liveWatches.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    documentMock.setVisibility("visible");
    await f.tracker.resume();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(watches).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["watcher", "request"])("does not leak timers after a synchronous permission denial in %s", async (source) => {
    const deny = () => { throw Object.assign(new Error("denied"), { name: "SecurityError" }); };
    if (source === "watcher") geolocation.watchPosition.mockImplementationOnce(deny);
    else geolocation.getCurrentPosition.mockImplementationOnce(deny);
    const f = fixture();
    await f.tracker.start();
    if (source === "request") await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(f.latest().autoRetryAllowed).toBe(false);
    expect(liveWatches.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await f.tracker.resume();
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("stops and clears the browser sampler on API authorization rejection", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "AUTHENTICATION_REQUIRED" }), { status: 401 }));
    const f = fixture();
    await f.tracker.start();
    watches[0].success(position());
    await settle();
    expect(f.latest().autoRetryAllowed).toBe(false);
    expect(liveWatches.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await f.tracker.resume();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe("GPS HTTP rejection evidence", () => {
  it.each([false, true])("keeps a single watcher and recovers after a generic proxy 401 (Android=%s)", async (android) => {
    native.android = android;
    if (android) native.post.mockResolvedValueOnce({ status: 401, data: "<html>Unauthorized</html>" });
    else fetchMock.mockResolvedValueOnce(new Response("<html>Unauthorized</html>", { status: 401 }));
    const f = fixture();
    await f.tracker.start();
    if (android) nativeCallbacks[0](location());
    else watches[0].success(position());
    await settle();
    expect(f.latest().state).toBe("error");
    expect(f.latest().autoRetryAllowed).toBe(true);
    expect(f.latest().lastAckAt).toBeUndefined();
    expect(android ? native.removeWatcher.mock.calls.length : liveWatches.size).toBe(android ? 0 : 1);
    await vi.advanceTimersByTimeAsync(1_000);
    if (android) nativeCallbacks[0](location());
    else watches[0].success(position());
    await settle();
    expect(f.latest().state).toBe("tracking");
    expect(f.latest().lastAckAt).toBe(Date.now());
    expect(android ? native.addWatcher.mock.calls.length : watches.length).toBe(1);
  });

  it.each(["AUTHENTICATION_REQUIRED", "RIDER_ACCESS_DENIED"])("still stops Android GPS for explicit %s", async (code) => {
    native.android = true;
    native.post.mockResolvedValueOnce({ status: 403, data: JSON.stringify({ error: code }) });
    const f = fixture();
    await f.tracker.start();
    nativeCallbacks[0](location());
    await settle();
    expect(f.latest().autoRetryAllowed).toBe(false);
    expect(native.removeWatcher).toHaveBeenCalledWith({ id: "native-1" });
    await f.tracker.resume();
    expect(native.addWatcher).toHaveBeenCalledTimes(1);
  });
});

describe("Android stationary provider", () => {
  it("uses the installed native bearing field rather than inventing a north heading", async () => {
    native.android = true;
    const f = fixture();
    await f.tracker.start();
    nativeCallbacks[0]({ ...location(), bearing: 95 });
    await settle();
    expect(f.onFix).toHaveBeenCalledWith(expect.objectContaining({ heading: 95 }));
  });

  it("rejects simulated Android GPS before map display or API publication", async () => {
    native.android = true;
    const f = fixture();
    await f.tracker.start();
    nativeCallbacks[0]({ ...location(), simulated: true });
    await settle();
    expect(native.post).not.toHaveBeenCalled();
    expect(f.onFix).not.toHaveBeenCalled();
    expect(f.latest().autoRetryAllowed).toBe(false);
    expect(native.removeWatcher).toHaveBeenCalledWith({ id: "native-1" });
  });

  it("uses distanceFilter 0 / stale false, real native timestamps and the existing 60 s publish policy", async () => {
    native.android = true;
    const f = fixture();
    await f.tracker.start();
    expect(native.addWatcher.mock.calls[0][0]).toMatchObject({ distanceFilter: 0, stale: false, requestPermissions: true });
    const first = location();
    nativeCallbacks[0](first);
    await settle();
    expect(native.post).toHaveBeenCalledTimes(1);
    expect(native.post.mock.calls[0][0]).toMatchObject({ data: coords, connectTimeout: 15_000, readTimeout: 15_000 });
    expect(f.latest().lastFixAt).toBe(first.time);
    const firstAck = f.latest().lastAckAt;
    // OS/provider still supplies genuinely new fixes while coordinates stay put.
    for (let i = 0; i < 59; i++) {
      await vi.advanceTimersByTimeAsync(1_000);
      nativeCallbacks[0](location());
      await settle();
    }
    expect(native.post).toHaveBeenCalledTimes(1);
    expect(f.latest().lastAckAt).toBe(firstAck);
    await vi.advanceTimersByTimeAsync(1_000);
    nativeCallbacks[0](first); // old/repeated callback must not refresh ACK
    nativeCallbacks[0](location(null)); // native time is never fabricated
    await settle();
    expect(native.post).toHaveBeenCalledTimes(1);
    nativeCallbacks[0](location());
    await settle();
    expect(native.post).toHaveBeenCalledTimes(2);
    expect(f.latest().lastFixAt).toBe(Date.now());
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    f.tracker.stop();
    await settle();
    nativeCallbacks[0](location());
    expect(native.removeWatcher).toHaveBeenCalledWith({ id: "native-1" });
    expect(native.post).toHaveBeenCalledTimes(2);
  });

  it("treats revoked Android location permission as terminal and removes the native watcher", async () => {
    native.android = true;
    const f = fixture();
    await f.tracker.start();
    nativeCallbacks[0](undefined, Object.assign(new Error("denied"), { code: "NOT_AUTHORIZED" }));
    await settle();
    expect(f.latest().autoRetryAllowed).toBe(false);
    expect(native.removeWatcher).toHaveBeenCalledWith({ id: "native-1" });
    await f.tracker.resume();
    expect(native.addWatcher).toHaveBeenCalledTimes(1);
  });

  it("does not start the provider after denied Android notification permission", async () => {
    native.android = true;
    native.checkPermissions.mockResolvedValue({ display: "denied" });
    const f = fixture();
    await f.tracker.start();
    expect(f.latest().autoRetryAllowed).toBe(false);
    await f.tracker.resume();
    expect(native.addWatcher).not.toHaveBeenCalled();
  });
});
