import { afterEach, expect, it, vi } from "vitest";
import { RIDER_GPS_STOP_EVENT, stopRiderDeviceGps } from "./riderGpsSession";
import { RiderGpsTracker, type GpsCallbacks } from "./riderGpsTracker";

afterEach(() => vi.unstubAllGlobals());

it("stops publishing synchronously on logout or end-of-shift invalidation", async () => {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  let callbacks!: GpsCallbacks;
  const publish = vi.fn(async () => {});
  const tracker = new RiderGpsTracker({
    add: async (input) => { callbacks = input; return "native"; },
    remove: vi.fn(async () => {}),
    publish,
  }, () => {});
  await tracker.start();
  target.addEventListener(RIDER_GPS_STOP_EVENT, () => tracker.stop());
  stopRiderDeviceGps();
  callbacks.onLocation({ latitude: 38.99, longitude: -0.52, accuracy: 8 });
  expect(publish).not.toHaveBeenCalled();
  expect(callbacks.isCurrent()).toBe(false);
});
