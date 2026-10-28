import { useSyncExternalStore } from "react";
import type { GpsPoint } from "./riderGpsPolicy";
import type { RiderGpsSnapshot } from "./riderGpsTracker";

export type RiderGpsMapPoint = { lat: number; lng: number; accuracy: number };

const idleSnapshot: RiderGpsSnapshot = {
  state: "idle",
  detail: "El GPS de este dispositivo está detenido.",
};
let snapshot = idleSnapshot;
let point: RiderGpsMapPoint | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function setRiderGpsSnapshot(next: RiderGpsSnapshot) {
  snapshot = next;
  if (next.state === "idle") point = null;
  notify();
}

export function setRiderGpsMapPoint(next: GpsPoint) {
  point = { lat: next.latitude, lng: next.longitude, accuracy: next.accuracy };
  notify();
}

export function resetRiderGpsState() {
  snapshot = idleSnapshot;
  point = null;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRiderGpsSnapshot() {
  return useSyncExternalStore(subscribe, () => snapshot, () => idleSnapshot);
}

export function useRiderGpsMapPoint() {
  return useSyncExternalStore(subscribe, () => point, () => null);
}
