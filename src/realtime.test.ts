import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectPikiRealtime } from "./realtime";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => ""), setItem: vi.fn() });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("navigator", { onLine: true });
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

  it.each([401, 403].flatMap(status => ["Unauthorized", "unauthorized", "UNAUTHORIZED", "AUTHENTICATION_REQUIRED:UPSTREAM", "AUTHENTICATION_REQUIRED_UPSTREAM"].map(error => ({ status, error }))))("retries ambiguous JSON HTTP $status $error instead of terminating", async ({ status, error }) => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error }), { status }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthExpired = vi.fn();
    const onAuthorizationError = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onAuthExpired, onAuthorizationError });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAuthExpired).not.toHaveBeenCalled();
    expect(onAuthorizationError).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403])("retries a message-only proxy response HTTP %s", async status => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{"message":"Unauthorized"}', { status }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthExpired = vi.fn(), onAuthorizationError = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onAuthExpired, onAuthorizationError });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAuthExpired).not.toHaveBeenCalled();
    expect(onAuthorizationError).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["HTML proxy", "<html>Forbidden</html>"], ["plain proxy", "Forbidden"],
    ["empty object", "{}"], ["malformed JSON", "{invalid"], ["null", "null"],
    ["message only", JSON.stringify({ message: "FORBIDDEN" })],
    ["role only", JSON.stringify({ role: "rider" })],
    ["unknown code", JSON.stringify({ error: "PROXY_FORBIDDEN" })],
    ["prefix code", JSON.stringify({ error: "FORBIDDEN_PROXY" })],
    ["nested code", JSON.stringify({ error: { code: "FORBIDDEN" } })],
    ["array", JSON.stringify([{ error: "FORBIDDEN" }])],
  ])("retries a 403 %s without invalidating auth/identity", async (_label, body) => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(body, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthExpired = vi.fn();
    const onAuthorizationError = vi.fn();
    const onState = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onState, onAuthExpired, onAuthorizationError });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenCalledWith(false);
    expect(onAuthExpired).not.toHaveBeenCalled();
    expect(onAuthorizationError).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops once for a structured JSON 403 role denial without reporting an invalid token", async () => {
    const body = { code: "FORBIDDEN" };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthorizationError = vi.fn();
    const onAuthExpired = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onAuthorizationError, onAuthExpired });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onAuthorizationError).toHaveBeenCalledExactlyOnceWith(403);
    expect(onAuthExpired).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403])("stops once and reports explicit API authentication failure HTTP %s", async status => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{"error":"AUTHENTICATION_REQUIRED"}', { status }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthExpired = vi.fn(), onAuthorizationError = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onAuthExpired, onAuthorizationError });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onAuthExpired).toHaveBeenCalledExactlyOnceWith(status);
    expect(onAuthorizationError).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403])("cannot terminate a disposed session on a late explicit HTTP %s body", async status => {
    let resolve!: (body: unknown) => void;
    const body = new Promise(done => { resolve = done; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status, clone: () => ({ json: () => body }) }));
    const onAuthExpired = vi.fn(), onAuthorizationError = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onAuthExpired, onAuthorizationError });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    resolve({ error: "AUTHENTICATION_REQUIRED" });
    await vi.advanceTimersByTimeAsync(0);
    expect(onAuthExpired).not.toHaveBeenCalled();
    expect(onAuthorizationError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds an unreadable 403 body and retries without discarding identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 403, ok: false, clone: () => ({ json: () => new Promise(() => {}) }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onAuthorizationError = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onAuthorizationError });
    await vi.advanceTimersByTimeAsync(17_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAuthorizationError).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not invalidate a disposed session when a 403 body resolves late", async () => {
    let resolve!: (body: unknown) => void;
    const body = new Promise((done) => { resolve = done; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 403, clone: () => ({ json: () => body }) }));
    const onAuthorizationError = vi.fn();
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fake", surface: "rider", onEvent: vi.fn(), onAuthorizationError });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    resolve({ error: "FORBIDDEN" });
    await vi.advanceTimersByTimeAsync(0);
    expect(onAuthorizationError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function recoveryFixture() {
  const sources: ReadableStreamDefaultController<Uint8Array>[] = [];
  const fetchMock = vi.fn((_url: string, _request: RequestInit) => Promise.resolve(new Response(
    new ReadableStream<Uint8Array>({ start(source) { sources.push(source); } }), { status: 200 },
  )));
  vi.stubGlobal("fetch", fetchMock);
  const onEvent = vi.fn(), onState = vi.fn();
  const connect = (token = "fixture-A") => connectPikiRealtime({ apiOrigin: "https://api.invalid", token, surface: "rider", onEvent, onState });
  return { sources, fetchMock, onEvent, onState, connect };
}

describe("SSE mobile recovery and session cursor — no live I/O", () => {
  it("aborts the suspended stream and reconnects once for an online/visible burst", async () => {
    const f = recoveryFixture(), stop = f.connect();
    await vi.advanceTimersByTimeAsync(0);
    const firstSignal = f.fetchMock.mock.calls[0][1].signal!;
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(firstSignal.aborted).toBe(true);
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(999);
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wakes an exponential retry immediately instead of waiting another 8 seconds", async () => {
    const f = recoveryFixture();
    f.fetchMock.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    const stop = f.connect();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(f.fetchMock).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.fetchMock).toHaveBeenCalledTimes(4);
    expect(f.fetchMock.mock.calls[3][1].headers).toMatchObject({ Authorization: "Bearer fixture-A" });
    stop(); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers a fetch that ignores abort without waiting its 15-second deadline", async () => {
    const fetchMock = vi.fn((_url: string, _request: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const stop = connectPikiRealtime({ apiOrigin: "https://api.invalid", token: "fixture-A", surface: "rider", onEvent: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    stop(); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not recover while hidden/offline, but resumes once visible and online", async () => {
    const f = recoveryFixture(), stop = f.connect();
    await vi.advanceTimersByTimeAsync(0);
    Object.assign(document, { visibilityState: "hidden" });
    window.dispatchEvent(new Event("online"));
    Object.assign(document, { visibilityState: "visible" });
    Object.assign(navigator, { onLine: false });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    Object.assign(navigator, { onLine: true });
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(0);
  });

  it("resumes IDs only for this connection, never sharing persisted rider cursors or bearer keys", async () => {
    const getItem = vi.fn(() => { throw new Error("storage unavailable / stale rider cursor"); });
    const setItem = vi.fn(() => { throw new Error("must not persist SSE data"); });
    vi.stubGlobal("sessionStorage", { getItem, setItem });
    const f = recoveryFixture(), stopA = f.connect();
    await vi.advanceTimersByTimeAsync(0);
    f.sources[0].enqueue(new TextEncoder().encode('id: rider-A-event-9\ndata: {"type":"order.message","payload":{}}\n\n'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.onEvent).toHaveBeenCalledOnce();
    f.sources[0].close();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.fetchMock.mock.calls[1][1].headers).toMatchObject({ "Last-Event-ID": "rider-A-event-9" });
    stopA(); await vi.advanceTimersByTimeAsync(0);
    const stopB = f.connect("fixture-B");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.fetchMock.mock.calls[2][1].headers).not.toHaveProperty("Last-Event-ID");
    expect(f.fetchMock.mock.calls[2][1].headers).toMatchObject({ Authorization: "Bearer fixture-B" });
    expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
    stopB(); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["disposed", "authentication", "authorization"])("cannot wake a %s connection and removes recovery listeners", async reason => {
    const f = recoveryFixture();
    if (reason !== "disposed") f.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: reason === "authentication" ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN" }), { status: 403 }));
    const windowCleanup = vi.spyOn(window, "removeEventListener"), documentCleanup = vi.spyOn(document, "removeEventListener");
    const stop = f.connect();
    await vi.advanceTimersByTimeAsync(0);
    if (reason === "disposed") stop();
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    expect(windowCleanup).toHaveBeenCalledWith("online", expect.any(Function));
    expect(documentCleanup).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });
});
