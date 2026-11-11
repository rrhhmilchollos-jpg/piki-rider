import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectPikiRealtime } from "./realtime";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => ""), setItem: vi.fn() });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function streamFixture() {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
  const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onState = vi.fn();
  const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onState });
  return { source, fetchMock, onState, stop };
}

describe("SSE deadlines", () => {
  it("aborts a stream silent for 60 s and reconnects with backoff", async () => {
    const f = streamFixture();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.onState).toHaveBeenCalledWith(false);
    expect(f.fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    f.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("comment heartbeats reset silence even without order events", async () => {
    const f = streamFixture();
    await vi.advanceTimersByTimeAsync(40_000);
    f.source.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    expect(f.onState).not.toHaveBeenCalledWith(false);
    f.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds a fetch that ignores abort and cancels backoff on disposal", async () => {
    const fetchMock = vi.fn((_url: string, _request: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn() });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([401, 428, 403])("does not reconnect after terminal HTTP %s", async (status) => {
    const error = status === 401 ? "AUTHENTICATION_REQUIRED" : status === 428 ? "PASSWORD_CHANGE_REQUIRED" : "FORBIDDEN";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), {
      status,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthExpired = vi.fn();
    const onAuthorizationError = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onAuthExpired, onAuthorizationError });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(status === 403 ? onAuthorizationError : onAuthExpired).toHaveBeenCalledWith(status);
    stop();
  });

  it("does not log out on an unstructured 401 from a proxy and keeps retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthExpired = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onAuthExpired });
    await vi.advanceTimersByTimeAsync(0);
    expect(onAuthExpired).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
