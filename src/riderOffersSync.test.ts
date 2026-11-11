import { afterEach, describe, expect, it, vi } from "vitest";
import { createRiderOffersSync, isLivePendingOffer, newPendingOfferIds, parseRiderOffersSnapshot } from "./riderOffersSync";
import { withRequestDeadline } from "./requestDeadline";
import type { RiderOffer } from "./types/rider";

const offer: RiderOffer = { _id: "offer-api-id", assignmentState: "offered", status: "preparing" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(request: (signal: AbortSignal) => Promise<RiderOffer[]>) {
  const onSnapshot = vi.fn();
  const onError = vi.fn();
  const onLoading = vi.fn();
  return { sync: createRiderOffersSync({ request, onSnapshot, onError, onLoading, timeoutMs: 100 }), onSnapshot, onError, onLoading };
}
afterEach(() => vi.useRealTimers());

describe("rider offers snapshot and alerts", () => {
  it("uses _id, alerts for an initial live offer and keeps assigned and offered together", () => {
    const assigned: RiderOffer = { ...offer, _id: "active", assignmentState: "assigned" };
    const snapshot = parseRiderOffersSnapshot({ offers: [assigned, offer] });
    expect(snapshot).toHaveLength(2);
    expect(newPendingOfferIds(snapshot, null)).toEqual([offer._id]);
    expect(newPendingOfferIds(snapshot, new Set([offer._id]))).toEqual([]);
  });
  it("uses offer expiry rather than order creation age, without inventing an expiry", () => {
    const now = Date.now();
    const oldOrder = { ...offer, createdAt: "2020-01-01T00:00:00Z", assignmentExpiresAt: new Date(now + 60_000).toISOString() };
    expect(newPendingOfferIds([oldOrder], new Set(), now)).toEqual([offer._id]);
    expect(isLivePendingOffer({ ...offer, assignmentExpiresAt: new Date(now - 1).toISOString() }, now)).toBe(false);
    expect(isLivePendingOffer({ ...offer, assignmentExpiresAt: "invalid" }, now)).toBe(false);
    expect(isLivePendingOffer({ ...offer, status: "on_the_way" }, now)).toBe(false);
  });
  it("rejects missing or malformed offers instead of erasing a previous snapshot", () => {
    expect(() => parseRiderOffersSnapshot({ orders: [offer] })).toThrow();
    expect(() => parseRiderOffersSnapshot({ offers: [{ ...offer, _id: null }] })).toThrow();
    expect(parseRiderOffersSnapshot({ offers: [] })).toEqual([]);
  });
});

describe("one bounded sync for polling, SSE and retry", () => {
  it("aborts a hung transport, releases inFlight and ignores a late old response", async () => {
    vi.useFakeTimers();
    const hung = deferred<RiderOffer[]>();
    let oldSignal!: AbortSignal;
    const request = vi.fn((signal: AbortSignal) => {
      oldSignal = signal;
      return hung.promise;
    }).mockImplementationOnce((signal) => { oldSignal = signal; return hung.promise; });
    const f = fixture(request);
    const first = f.sync.refresh();
    await vi.advanceTimersByTimeAsync(100);
    await first;
    expect(oldSignal.aborted).toBe(true);
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.onLoading.mock.calls).toEqual([[true], [false]]);
    request.mockResolvedValueOnce([offer]);
    await f.sync.refresh();
    expect(f.onSnapshot).toHaveBeenCalledExactlyOnceWith([offer]);
    hung.resolve([]);
    await Promise.resolve();
    expect(f.onSnapshot).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("coalesces event/retry bursts behind one request, while interval ticks do not queue", async () => {
    const first = deferred<RiderOffer[]>();
    const request = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([offer]);
    const f = fixture(request);
    const run = f.sync.refresh();
    void f.sync.refresh(false);
    void f.sync.refresh();
    void f.sync.refresh();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    first.resolve([offer]);
    await run;
    expect(request).toHaveBeenCalledTimes(2);
    expect(f.onLoading.mock.calls).toEqual([[true], [false]]);
  });
  it("dispose immediately aborts, settles ignored transports and prevents all late UI updates", async () => {
    vi.useFakeTimers();
    const hung = deferred<RiderOffer[]>();
    let signal!: AbortSignal;
    const f = fixture((input) => { signal = input; return hung.promise; });
    const run = f.sync.refresh();
    await Promise.resolve();
    f.sync.dispose();
    await run;
    expect(signal.aborted).toBe(true);
    hung.resolve([offer]);
    await Promise.resolve();
    expect(f.onSnapshot).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains last good snapshot and only clears an error after a real successful retry", async () => {
    const snapshot = [offer];
    let stored: RiderOffer[] = [];
    let error: unknown;
    const request = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(snapshot);
    const sync = createRiderOffersSync({ request, onSnapshot: (next) => { stored = next; error = null; }, onError: (next) => { error = next; }, onLoading: () => {} });
    await sync.refresh();
    await sync.refresh();
    expect(stored).toEqual(snapshot);
    expect(error).toBeInstanceOf(Error);
    await sync.refresh();
    expect(error).toBeNull();
  });
  it("covers a stalled response-body parser with the same deadline", async () => {
    vi.useFakeTimers();
    const f = fixture(async () => {
      await Promise.resolve(); // Simulates receiving headers.
      return new Promise<RiderOffer[]>(() => {}); // json() never settles.
    });
    const run = f.sync.refresh();
    await vi.advanceTimersByTimeAsync(100);
    await run;
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.onSnapshot).not.toHaveBeenCalled();
  });
  it("never calls a transport if the deadline controller was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn();
    await expect(withRequestDeadline(request, controller, 100)).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });
});
