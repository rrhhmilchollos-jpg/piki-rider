import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tokenKey = "piki-rider.invalid-api-token";
const validationKey = "piki-rider.invalid-employee-session-validated";
let local: Map<string, string>;
let session: Map<string, string>;
let events: EventTarget;
function storage(map: Map<string, string>) {
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) };
}
beforeEach(() => {
  vi.resetModules();
  local = new Map();
  session = new Map();
  events = new EventTarget();
  vi.stubGlobal("location", { hostname: "rider.invalid" });
  vi.stubGlobal("localStorage", storage(local));
  vi.stubGlobal("sessionStorage", storage(session));
  vi.stubGlobal("window", events);
});
afterEach(() => { vi.unstubAllGlobals(); });

function storageEvent(key: string | null): Event {
  return Object.assign(new Event("storage"), { key });
}

describe("token changes invalidate identity immediately", () => {
  it("notifies synchronously after same-tab token change/logout with current stored value", async () => {
    const { clearStoredToken, getStoredToken, storeToken, subscribeStoredToken } = await import("./authStorage");
    const changes: string[] = [];
    const unsubscribe = subscribeStoredToken(() => changes.push(getStoredToken()));
    storeToken("token-A");
    expect(changes).toEqual(["token-A"]);
    storeToken("token-B");
    expect(changes).toEqual(["token-A", "token-B"]);
    clearStoredToken();
    expect(changes).toEqual(["token-A", "token-B", ""]);
    unsubscribe();
    storeToken("token-C");
    expect(changes).toHaveLength(3);
  });
  it("does not resurrect stale sessionStorage credentials after another tab logs out", async () => {
    const { getStoredToken, subscribeStoredToken } = await import("./authStorage");
    session.set(tokenKey, "old-token");
    session.set(validationKey, "1");
    const changed = vi.fn(() => expect(getStoredToken()).toBe(""));
    const unsubscribe = subscribeStoredToken(changed);
    events.dispatchEvent(storageEvent(tokenKey));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(session.has(tokenKey)).toBe(false);
    expect(session.has(validationKey)).toBe(false);
    unsubscribe();
  });
  it("reads another tab's new credential, handles storage.clear(), ignores unrelated storage", async () => {
    const { getStoredToken, subscribeStoredToken } = await import("./authStorage");
    local.set(tokenKey, "new-token");
    session.set(tokenKey, "old-token");
    const changed = vi.fn();
    const unsubscribe = subscribeStoredToken(changed);
    events.dispatchEvent(storageEvent("cookie-consent"));
    expect(changed).not.toHaveBeenCalled();
    events.dispatchEvent(storageEvent(tokenKey));
    expect(getStoredToken()).toBe("new-token");
    expect(changed).toHaveBeenCalledTimes(1);
    local.clear();
    events.dispatchEvent(storageEvent(null));
    expect(getStoredToken()).toBe("");
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
