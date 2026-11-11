import { describe, expect, it, vi } from "vitest";
import {
  RiderGpsAuthorizationError,
  RiderGpsPermissionError,
  RiderGpsTracker,
  type GpsCallbacks,
  type GpsPort,
  type RiderGpsSnapshot,
} from "./riderGpsTracker";

const point = { latitude: 38.989, longitude: -0.52, accuracy: 8 };
const fix = () => ({ ...point, timestamp: Date.now() });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(override: Partial<GpsPort> = {}) {
  let callbacks!: GpsCallbacks;
  const states: RiderGpsSnapshot[] = [];
  const diagnose = vi.fn();
  const port: GpsPort = {
    add: vi.fn(async (input) => { callbacks = input; return "watcher-1"; }),
    remove: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
    diagnose,
    ...override,
  };
  const tracker = new RiderGpsTracker(port, (state) => states.push(state));
  return { tracker, port, states, diagnose, callbacks: () => callbacks };
}

describe("Rider GPS lifecycle", () => {
  it("does not publish or claim an API acknowledgement before an explicit start and ack", async () => {
    const sent = deferred<void>();
    const f = fixture({ publish: vi.fn(() => sent.promise) });
    expect(f.port.add).not.toHaveBeenCalled();
    await f.tracker.start();
    expect(f.states.at(-1)?.state).toBe("waiting");
    f.callbacks().onLocation(fix());
    expect(f.states.at(-1)?.lastAckAt).toBeUndefined();
    sent.resolve();
    await tick();
    expect(f.states.at(-1)?.state).toBe("tracking");
    expect(f.states.at(-1)?.lastAckAt).toBeTypeOf("number");
  });

  it("correlates each successful ACK with exactly the provider fix sent, not a newer pending fix", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      const sent = deferred<void>();
      const f = fixture({ publish: vi.fn(() => sent.promise) });
      await f.tracker.start();
      const first = fix();
      f.callbacks().onLocation(first);
      expect(f.states.at(-1)?.lastAcknowledgedFix).toBeUndefined();
      await vi.advanceTimersByTimeAsync(10);
      const pending = { ...fix(), accuracy: 9 };
      f.callbacks().onLocation(pending);
      sent.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.states.at(-1)?.lastFixAt).toBe(pending.timestamp);
      expect(f.states.at(-1)?.lastAcknowledgedFix).toEqual(first);
      f.tracker.stop();
      expect(f.states.at(-1)?.lastAcknowledgedFix).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it("invalidates callbacks and late acknowledgements synchronously after stop", async () => {
    const sent = deferred<void>();
    const f = fixture({ publish: vi.fn(() => sent.promise) });
    await f.tracker.start();
    f.callbacks().onLocation(fix());
    f.tracker.stop();
    const stateCount = f.states.length;
    f.callbacks().onLocation(fix());
    sent.resolve();
    await tick();
    expect(f.port.publish).toHaveBeenCalledTimes(1);
    expect(f.states).toHaveLength(stateCount);
    expect(f.states.at(-1)?.state).toBe("idle");
    expect(f.callbacks().isCurrent()).toBe(false);
  });

  it("removes an identifier that arrives after cancellation and exposes cancellation to the adapter", async () => {
    const id = deferred<string>();
    let input!: GpsCallbacks;
    const f = fixture({ add: vi.fn((callbacks) => { input = callbacks; return id.promise; }) });
    const starting = f.tracker.start();
    await tick();
    expect(input.isCurrent()).toBe(true);
    f.tracker.stop();
    expect(input.isCurrent()).toBe(false);
    id.resolve("late-watcher");
    await starting;
    expect(f.port.remove).toHaveBeenCalledWith("late-watcher");
  });

  it("retains a rejected removal id, retries it, and refuses a new watcher while it remains active", async () => {
    let fail = true;
    const remove = vi.fn(async () => { if (fail) throw new Error("native failed"); });
    const f = fixture({ remove });
    await f.tracker.start();
    f.tracker.stop();
    await tick();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(f.states.at(-1)?.state).toBe("error");
    await f.tracker.start();
    expect(f.port.add).toHaveBeenCalledTimes(1);
    fail = false;
    f.tracker.stop();
    await tick();
    expect(remove).toHaveBeenLastCalledWith("watcher-1");
    expect(f.states.at(-1)?.state).toBe("idle");
  });

  it("stops after an authorization rejection and never posts a later fix", async () => {
    const f = fixture({ publish: vi.fn(async () => { throw new RiderGpsAuthorizationError("Sesión caducada"); }) });
    await f.tracker.start();
    f.callbacks().onLocation(fix());
    await tick();
    f.callbacks().onLocation(fix());
    expect(f.port.publish).toHaveBeenCalledTimes(1);
    expect(f.port.remove).toHaveBeenCalledWith("watcher-1");
    expect(f.states.at(-1)?.state).toBe("error");
  });

  it("emits only the implemented diagnostic lifecycle events", async () => {
    const f = fixture();
    await f.tracker.start();
    f.callbacks().onLocation(fix());
    await tick();
    f.tracker.stop();
    await tick();
    expect(f.diagnose.mock.calls.map(([event]) => event)).toEqual([
      "watch_start",
      "fix_received",
      "send_ack",
      "watch_stop",
    ]);
  });

  it("marks a send failure without pretending it was acknowledged and emits send_error", async () => {
    const f = fixture({ publish: vi.fn(async () => { throw new Error("Sin red"); }) });
    await f.tracker.start();
    f.callbacks().onLocation(fix());
    await tick();
    expect(f.states.at(-1)?.state).toBe("error");
    expect(f.states.at(-1)?.lastAckAt).toBeUndefined();
    expect(f.diagnose).toHaveBeenCalledWith("send_error");
  });

  it("does not republish an unchanged fix immediately, while preserving the active watcher", async () => {
    const f = fixture();
    await f.tracker.start();
    f.callbacks().onLocation(fix());
    await tick();
    f.callbacks().onLocation({ ...fix(), accuracy: 9 });
    await tick();
    expect(f.port.publish).toHaveBeenCalledTimes(1);
    expect(f.states.at(-1)?.state).toBe("tracking");
  });

  it("keeps a watcher after a transient error and recovers only on a real new fix/ack", async () => {
    const f = fixture();
    await f.tracker.start();
    f.callbacks().onLocation(fix());
    await tick();
    const ack = f.states.at(-1)?.lastAckAt;
    f.callbacks().onError(new Error("Timeout GPS"));
    expect(f.port.remove).not.toHaveBeenCalled();
    expect(f.callbacks().isCurrent()).toBe(true);
    expect(f.states.at(-1)?.lastAckAt).toBe(ack);
    await tick();
    f.callbacks().onLocation(fix());
    await tick();
    expect(f.port.publish).toHaveBeenCalledTimes(2);
    expect(f.states.at(-1)?.state).toBe("tracking");
  });

  it("does not auto-retry a denied permission, while explicit user retry is possible", async () => {
    const f = fixture();
    await f.tracker.start();
    f.callbacks().onError(new RiderGpsPermissionError("Permiso denegado"));
    await tick();
    expect(f.callbacks().isCurrent()).toBe(false);
    await f.tracker.resume();
    expect(f.port.add).toHaveBeenCalledTimes(1);
    await f.tracker.start();
    expect(f.port.add).toHaveBeenCalledTimes(2);
  });

  it("rate limits automatic foreground retries and never retries API authorization errors", async () => {
    const f = fixture({ add: vi.fn(async () => { throw new Error("Abre la app"); }) });
    await f.tracker.resume();
    await f.tracker.resume();
    expect(f.port.add).toHaveBeenCalledTimes(1);
    const blocked = fixture({ publish: vi.fn(async () => { throw new RiderGpsAuthorizationError("401"); }) });
    await blocked.tracker.start();
    blocked.callbacks().onLocation(fix());
    await tick();
    await blocked.tracker.resume();
    expect(blocked.port.add).toHaveBeenCalledTimes(1);
  });

  it("uses provider time and refuses duplicate, missing, stale, future or out-of-order timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      const f = fixture();
      await f.tracker.start();
      const realFix = { ...point, timestamp: Date.now() - 100 };
      f.callbacks().onLocation(realFix);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.states.at(-1)?.lastFixAt).toBe(realFix.timestamp);
      const ack = f.states.at(-1)?.lastAckAt;
      await vi.advanceTimersByTimeAsync(60_000);
      for (const timestamp of [realFix.timestamp, NaN, Date.now() - 15_001, Date.now() + 1]) {
        f.callbacks().onLocation({ ...point, timestamp });
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(f.port.publish).toHaveBeenCalledTimes(1);
      expect(f.states.at(-1)?.lastAckAt).toBe(ack);
      f.callbacks().onLocation(fix());
      await vi.advanceTimersByTimeAsync(0);
      expect(f.port.publish).toHaveBeenCalledTimes(2);
      const latestFixAt = f.states.at(-1)?.lastFixAt;
      f.callbacks().onLocation({ ...point, timestamp: Date.now() - 1 });
      expect(f.states.at(-1)?.lastFixAt).toBe(latestFixAt);
      f.tracker.stop();
    } finally { vi.useRealTimers(); }
  });

  it("does not republish a queued provider fix after it becomes stale behind a slow POST", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      const sent = deferred<void>();
      const f = fixture({ publish: vi.fn(() => sent.promise) });
      await f.tracker.start();
      f.callbacks().onLocation(fix());
      await vi.advanceTimersByTimeAsync(1_000);
      f.callbacks().onLocation({ ...fix(), latitude: point.latitude + 0.001 });
      const capturedAt = f.states.at(-1)?.lastFixAt;
      await vi.advanceTimersByTimeAsync(60_000);
      sent.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.port.publish).toHaveBeenCalledTimes(1);
      expect(f.states.at(-1)?.lastFixAt).toBe(capturedAt);
      // The only ACK comes from the actual completed POST, not the queued fix.
      expect(f.diagnose.mock.calls.filter(([event]) => event === "send_ack")).toHaveLength(1);
      f.tracker.stop();
    } finally { vi.useRealTimers(); }
  });

  it("never manufactures a heartbeat acknowledgement when no new fix arrives", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      await f.tracker.start();
      f.callbacks().onLocation(fix());
      await vi.advanceTimersByTimeAsync(0);
      const ack = f.states.at(-1)?.lastAckAt;
      await vi.advanceTimersByTimeAsync(91_000);
      expect(f.port.publish).toHaveBeenCalledTimes(1);
      expect(f.states.at(-1)?.lastAckAt).toBe(ack);
      f.tracker.stop();
    } finally { vi.useRealTimers(); }
  });
});
