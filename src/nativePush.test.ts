import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ android: true, checkPermissions: vi.fn(async () => ({ receive: "granted" })),
  requestPermissions: vi.fn(async () => ({ receive: "granted" })), addListener: vi.fn(), removeAllListeners: vi.fn(),
  register: vi.fn(async () => {}), prepareChannels: vi.fn(async () => ({ shift: true, order: true, cancelled: true })) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.android, getPlatform: () => native.android ? "android" : "web" }, registerPlugin: () => native }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: native }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: {} }));
import { registerRiderPush, cancelRiderPushRegistration } from "./nativePush";
let listeners: Map<string, (data: any) => void>;
let handles: ReturnType<typeof vi.fn>[];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); native.android = true;
  native.checkPermissions.mockResolvedValue({ receive: "granted" });
  listeners = new Map(); handles = [];
  native.addListener.mockImplementation(async (name, callback) => { listeners.set(name, callback); const remove = vi.fn(async () => {}); handles.push(remove); return { remove }; });
  native.register.mockImplementation(async () => { listeners.get("registration")?.({ value: "mock-fcm-token" }); });
  fetchMock = vi.fn(async () => ({ ok: true, status: 201 })); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cancelRiderPushRegistration(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("native FCM registration", () => {
  it("returns true only after API confirmation and keeps the strict token/platform schema", async () => {
    expect(await registerRiderPush("https://push.invalid", "mock-session")).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "mock-fcm-token", platform: "android" });
    expect(handles.every((remove) => remove.mock.calls.length === 1)).toBe(true);
    expect(native.removeAllListeners).not.toHaveBeenCalled();
  });
  it("does not prompt automatically on login or browser mode", async () => {
    native.checkPermissions.mockResolvedValue({ receive: "prompt" });
    expect(await registerRiderPush("https://push.invalid", "mock-session")).toBe(false);
    expect(native.requestPermissions).not.toHaveBeenCalled();
    native.android = false; expect(await registerRiderPush("https://push.invalid", "mock-session")).toBe(false);
  });
  it("can request permission only via an explicit consent option", async () => {
    native.checkPermissions.mockResolvedValue({ receive: "prompt" });
    expect(await registerRiderPush("https://push.invalid", "mock-session", { requestPermission: true })).toBe(true);
    expect(native.requestPermissions).toHaveBeenCalledTimes(1);
  });
  it("API failure never reports that FCM is successfully registered", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    expect(await registerRiderPush("https://push.invalid", "mock-session")).toBe(false);
  });
  it("times out safely if Firebase never returns a token", async () => {
    native.register.mockResolvedValue(undefined);
    const pending = registerRiderPush("https://push.invalid", "mock-session");
    await vi.advanceTimersByTimeAsync(20000); expect(await pending).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("logout aborts a pending token request without accepting its late success", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = registerRiderPush("https://push.invalid", "mock-session");
    await vi.advanceTimersByTimeAsync(0); cancelRiderPushRegistration();
    expect(await pending).toBe(false); expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    resolve({ ok: true }); await vi.advanceTimersByTimeAsync(0);
  });
});
