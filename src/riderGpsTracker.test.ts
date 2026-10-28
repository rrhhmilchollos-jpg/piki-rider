import { describe, expect, it, vi } from "vitest";
import {
  RiderGpsAuthorizationError,
  RiderGpsTracker,
  type GpsCallbacks,
  type GpsPort,
  type RiderGpsSnapshot,
} from "./riderGpsTracker";

const point = { latitude: 38.989, longitude: -0.52, accuracy: 8 };
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
    f.callbacks().onLocation(point);
    expect(f.states.at(-1)?.lastAckAt).toBeUndefined();
    sent.resolve();
    await tick();
    expect(f.states.at(-1)?.state).toBe("tracking");
    expect(f.states.at(-1)?.lastAckAt).toBeTypeOf("number");
  });

  it("invalidates callbacks and late acknowledgements synchronously after stop", async () => {
    const sent = deferred<void>();
    const f = fixture({ publish: vi.fn(() => sent.promise) });
    await f.tracker.start();
    f.callbacks().onLocation(point);
    f.tracker.stop();
    const stateCount = f.states.length;
    f.callbacks().onLocation(point);
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
    f.callbacks().onLocation(point);
    await tick();
    f.callbacks().onLocation(point);
    expect(f.port.publish).toHaveBeenCalledTimes(1);
    expect(f.port.remove).toHaveBeenCalledWith("watcher-1");
    expect(f.states.at(-1)?.state).toBe("error");
  });

  it("emits only the implemented diagnostic lifecycle events", async () => {
    const f = fixture();
    await f.tracker.start();
    f.callbacks().onLocation(point);
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
    f.callbacks().onLocation(point);
    await tick();
    expect(f.states.at(-1)?.state).toBe("error");
    expect(f.states.at(-1)?.lastAckAt).toBeUndefined();
    expect(f.diagnose).toHaveBeenCalledWith("send_error");
  });

  it("does not republish an unchanged fix immediately, while preserving the active watcher", async () => {
    const f = fixture();
    await f.tracker.start();
    f.callbacks().onLocation(point);
    await tick();
    f.callbacks().onLocation({ ...point, accuracy: 9 });
    await tick();
    expect(f.port.publish).toHaveBeenCalledTimes(1);
    expect(f.states.at(-1)?.state).toBe("tracking");
  });
});
