import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishRiderLocation, riderLocationPublishTimeoutMs } from "./integrations/piki-api";

const native = vi.hoisted(() => ({ enabled: false, post: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.enabled },
  CapacitorHttp: { post: native.post },
}));
const point = { latitude: 38.989, longitude: -0.52, accuracy: 8, heading: 95, speedMps: 0 };
const ack = { rider: { id: "rider-offline", location: { type: "Point", coordinates: [point.longitude, point.latitude] } } };
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
beforeEach(() => { native.enabled = false; native.post.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("publishRiderLocation web deadline — offline fetch fixtures", () => {
  it("sends one POST with the original fix and returns the real response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(ack));
    vi.stubGlobal("fetch", fetchMock);
    expect(await publishRiderLocation(" mock-token ", "rider/offline", point)).toEqual(ack);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/riders/rider%2Foffline/location");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ Authorization: "Bearer mock-token", "Content-Type": "application/json" });
    expect(JSON.parse(request.body)).toEqual(point);
    expect(request.signal.aborted).toBe(false);
    expect(native.post).not.toHaveBeenCalled();
  });
  it.each(["fetch", "success body", "error body"])("bounds a stalled %s, aborts and never automatically repeats the POST", async (part) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => part === "fetch" ? new Promise(() => {}) : Promise.resolve({
      ok: part === "success body", status: part === "success body" ? 200 : 503,
      json: () => new Promise(() => {}), text: () => new Promise(() => {}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const settled = vi.fn();
    const pending = publishRiderLocation("mock-token", "rider-offline", point).then(settled, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(riderLocationPublishTimeoutMs - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ name: "TimeoutError" });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses one deadline across fetch and body, and a late response cannot confirm success", async () => {
    vi.useFakeTimers();
    let resolveFetch!: (response: Response) => void;
    let resolveBody!: (data: unknown) => void;
    const body = new Promise((done) => { resolveBody = done; });
    const fetchMock = vi.fn(() => new Promise<Response>((done) => { resolveFetch = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const acknowledged = vi.fn();
    const pending = publishRiderLocation("mock-token", "rider-offline", point).then(acknowledged, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    resolveFetch({ ok: true, status: 200, json: () => body } as Response);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toMatchObject({ name: "TimeoutError" });
    resolveBody(ack);
    await vi.advanceTimersByTimeAsync(0);
    expect(acknowledged).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves HTTP rejection evidence and does not retry a rejected POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: "RIDER_SESSION_NOT_ACTIVE" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    await expect(publishRiderLocation("mock-token", "rider-offline", point)).rejects.toThrow('API 409: {"error":"RIDER_SESSION_NOT_ACTIVE"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("never replaces an invalid/HTML success body with a fabricated location", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>proxy login</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(publishRiderLocation("mock-token", "rider-offline", point)).rejects.toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("publishRiderLocation native contract stays unchanged", () => {
  it("keeps the plugin connect/read timeouts and publishes only the real fix", async () => {
    native.enabled = true;
    native.post.mockResolvedValue({ status: 200, data: ack });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await publishRiderLocation("mock-token", "rider-offline", point)).toEqual(ack);
    expect(native.post).toHaveBeenCalledTimes(1);
    expect(native.post.mock.calls[0][0]).toMatchObject({ data: point, connectTimeout: 15_000, readTimeout: 15_000 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not automatically repeat a native POST after a plugin timeout", async () => {
    native.enabled = true;
    native.post.mockRejectedValue(new DOMException("Offline timeout", "TimeoutError"));
    await expect(publishRiderLocation("mock-token", "rider-offline", point)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(native.post).toHaveBeenCalledTimes(1);
  });
});
