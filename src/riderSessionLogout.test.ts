import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { AccountIdentitySession, parseEmployeeIdentity } from "./accountIdentity";

// Execute the actual session callbacks and storage subscription, never App effects,
// native services, a browser or the API. There is no real-fetch fallback.
const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const invalidateAccountIdentity = useCallback(");
const end = source.indexOf("  const saveOwnPhoto = useCallback(", start);
if (start < 0 || end < 0) throw new Error("Rider session callbacks not found");
const callbacks = source.slice(start, end);
const compile = (input: string) => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const headers = source.slice(source.indexOf("function authHeaders("), source.indexOf("const nav ="));
const executable = compile(`${headers}\n${callbacks}\n({ endRiderSession, beginRiderSession, logoutRiderSession });`);
const storageSource = readFileSync(new URL("./authStorage.ts", import.meta.url), "utf8");
const tokenKey = "piki-fixture.rider.invalid-api-token";
const validationKey = "piki-fixture.rider.invalid-employee-session-validated";
const emailKey = "piki-fixture.rider.invalid-login-email";
const storage = () => {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) };
};
function fixture() {
  const localStorage = storage(), sessionStorage = storage();
  localStorage.setItem(tokenKey, "SYNTHETIC_A"); sessionStorage.setItem(tokenKey, "SYNTHETIC_A");
  localStorage.setItem(emailKey, "a@example.invalid"); sessionStorage.setItem(validationKey, "1");
  localStorage.setItem("unrelated", "keep"); sessionStorage.setItem("unrelated", "keep");
  const window = Object.assign(new EventTarget(), { setTimeout: vi.fn((_callback: () => void, _delay: number) => 1), clearTimeout: vi.fn() });
  const stored: Record<string, any> = {};
  runInNewContext(compile(storageSource), { exports: stored, location: { hostname: "fixture.rider.invalid" }, window, localStorage, sessionStorage, Event });
  const identitySession = new AccountIdentitySession("SYNTHETIC_A");
  const seedIdentity = (id: string) => identitySession.applyRead(identitySession.beginRead(), parseEmployeeIdentity({ employee: { id, name: id, role: "rider", photoUrl: "data:image/jpeg;base64,AQID" } }));
  seedIdentity("A");
  const state: Record<string, any> = {};
  const setters: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of new Set([...callbacks.matchAll(/\b(set[A-Z]\w*)\(/g)].map((match) => match[1]))) {
    state[name] = "SENSITIVE_A";
    setters[name] = vi.fn((value: unknown) => { state[name] = value; });
  }
  const refs = {
    riderSessionEpochRef: { current: 1 }, activeTokenRef: { current: "SYNTHETIC_A" },
    riderIdentityRef: { current: "A" }, riderShiftSyncRef: { current: { reset: vi.fn() } },
    shiftActiveRef: { current: true }, riderOrdersRef: { current: ["ORDER_A"] },
    cancelledOrderIdsRef: { current: new Set(["ORDER_A"]) }, knownOfferIdsRef: { current: new Set(["OFFER_A"]) },
    assignedOrderRef: { current: true }, riderRefreshQueuedRef: { current: true },
    lastOfferAtRef: { current: 1 }, lastMobilityAlertRef: { current: "ALERT_A" }, lastAlertAtRef: { current: 1 },
  };
  let resolve!: (response: Response) => void, reject!: (error: Error) => void;
  const pending = new Promise<Response>((done, fail) => { resolve = done; reject = fail; });
  const fetch = vi.fn((_url: string, _init: RequestInit) => pending);
  const console = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const native = {
    cancelRiderPushRegistration: vi.fn(), clearRiderNativeAlerts: vi.fn().mockResolvedValue(undefined),
    clearShiftStartAlarms: vi.fn().mockResolvedValue(undefined), invalidateRiderGps: vi.fn(),
    registerRiderPush: vi.fn().mockResolvedValue(undefined), riderArrivalAlerts: { reset: vi.fn() },
  };
  const actions = runInNewContext(executable, {
    ...stored, ...refs, ...setters, ...native, identitySession, fetch, console,
    window, AbortController, apiOrigin: "https://offline.example.invalid", defaultRiderAudioPreferences: {},
    useCallback: (fn: unknown) => fn, useEffect: (fn: () => unknown) => fn(),
  }) as { endRiderSession: (message?: string) => void; beginRiderSession: (token: string) => void; logoutRiderSession: () => Promise<void> };
  return { ...actions, localStorage, sessionStorage, window, refs, state, setters, fetch, console, native, identitySession, seedIdentity, resolve, reject };
}
function expectCleared(f: ReturnType<typeof fixture>) {
  expect(f.refs.activeTokenRef.current).toBe(""); expect(f.identitySession.getSnapshot()).toBeNull();
  expect(f.localStorage.getItem(tokenKey)).toBeNull(); expect(f.sessionStorage.getItem(tokenKey)).toBeNull();
  expect(f.localStorage.getItem(emailKey)).toBeNull(); expect(f.sessionStorage.getItem(validationKey)).toBeNull();
  expect(f.localStorage.getItem("unrelated")).toBe("keep"); expect(f.sessionStorage.getItem("unrelated")).toBe("keep");
  expect(f.state.setApiToken).toBe(""); expect(f.state.setAuthRequired).toBe(true);
  expect(f.state.setRiderProfile).toEqual({ name: "", email: "", riderCode: "" });
  expect(f.state.setOffers).toEqual([]); expect(f.state.setShifts).toEqual([]); expect(f.state.setSupportChatMessages).toEqual([]);
  expect(f.state.setSupportChatDraft).toBe(""); expect(f.state.setPhotoBusy).toBe(false); expect(f.state.setProfileOpen).toBe(false);
  expect(f.refs.riderOrdersRef.current).toEqual([]); expect(f.refs.cancelledOrderIdsRef.current.size).toBe(0);
  expect(f.native.cancelRiderPushRegistration).toHaveBeenCalled(); expect(f.native.invalidateRiderGps).toHaveBeenCalled();
}
function replaceFromOtherTab(f: ReturnType<typeof fixture>, token: string | null) {
  if (token) f.localStorage.setItem(tokenKey, token); else f.localStorage.removeItem(tokenKey);
  f.window.dispatchEvent(Object.assign(new Event("storage"), { key: tokenKey }));
}

describe("Explicit Rider logout revocation (offline)", () => {
  it("clears all scoped memory/storage synchronously, sends one bodyless POST with the captured Bearer and stays cleared on network failure", async () => {
    const f = fixture();
    f.fetch.mockImplementationOnce((_url, _init) => { expectCleared(f); return new Promise<Response>((_resolve, reject) => { f.reject = reject; }); });
    const pending = f.logoutRiderSession();
    expectCleared(f); expect(f.fetch).toHaveBeenCalledOnce();
    const [url, init] = f.fetch.mock.calls[0];
    expect(url).toBe("https://offline.example.invalid/api/v1/auth/employee/logout");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", headers: { Authorization: "Bearer SYNTHETIC_A" } });
    expect(init.body).toBeUndefined(); expect(init.signal!.aborted).toBe(false);
    expect(f.window.setTimeout).toHaveBeenCalledWith(expect.any(Function), 10_000);
    f.reject(new Error("fixture offline")); await pending; expectCleared(f);
    expect(f.window.clearTimeout).toHaveBeenCalledOnce();
    for (const log of Object.values(f.console)) expect(log).not.toHaveBeenCalled();
    await f.logoutRiderSession(); expect(f.fetch).toHaveBeenCalledOnce();
  });

  it.each([204, 401, 428, "network"])("never applies late logout %s to fast account B", async (outcome) => {
    const f = fixture(); const pending = f.logoutRiderSession(); expectCleared(f);
    f.beginRiderSession("SYNTHETIC_B"); f.seedIdentity("B");
    f.state.setOffers = ["ORDER_B"]; f.state.setPhotoBusy = true; f.state.setToast = "NOTICE_B";
    const before = JSON.stringify(f.state); const epoch = f.refs.riderSessionEpochRef.current;
    const json = vi.fn(() => { throw new Error("Logout must not parse/apply the response"); });
    if (outcome === "network") f.reject(new Error("fixture offline"));
    else f.resolve({ ok: outcome === 204, status: outcome, json } as unknown as Response);
    await pending;
    expect(json).not.toHaveBeenCalled(); expect(JSON.stringify(f.state)).toBe(before);
    expect(f.refs.riderSessionEpochRef.current).toBe(epoch); expect(f.refs.activeTokenRef.current).toBe("SYNTHETIC_B");
    expect(f.localStorage.getItem(tokenKey)).toBe("SYNTHETIC_B"); expect(f.sessionStorage.getItem(tokenKey)).toBe("SYNTHETIC_B");
    expect(f.identitySession.getSnapshot()!.id).toBe("B"); expect(f.fetch).toHaveBeenCalledOnce();
    for (const log of Object.values(f.console)) expect(log).not.toHaveBeenCalled();
  });

  it("aborts only the old logout request after 10s and cannot clear B", async () => {
    const f = fixture();
    f.fetch.mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("fixture timeout")))));
    const pending = f.logoutRiderSession(); f.beginRiderSession("SYNTHETIC_B"); f.seedIdentity("B");
    f.window.setTimeout.mock.calls[0][0](); await pending;
    expect(f.fetch.mock.calls[0][1].signal!.aborted).toBe(true);
    expect(f.refs.activeTokenRef.current).toBe("SYNTHETIC_B"); expect(f.identitySession.getSnapshot()!.id).toBe("B");
    expect(f.localStorage.getItem(tokenKey)).toBe("SYNTHETIC_B"); expect(f.window.clearTimeout).toHaveBeenCalledOnce();
  });

  it("does not POST on same-tab account replacement, storage replacement/logout or auth expiry", () => {
    const f = fixture();
    f.beginRiderSession("SYNTHETIC_B"); expect(f.fetch).not.toHaveBeenCalled();
    replaceFromOtherTab(f, "SYNTHETIC_C"); expect(f.refs.activeTokenRef.current).toBe("SYNTHETIC_C");
    replaceFromOtherTab(f, null); expectCleared(f); expect(f.fetch).not.toHaveBeenCalled();
    f.beginRiderSession("SYNTHETIC_D"); f.endRiderSession("Tu sesión ha caducado.");
    expectCleared(f); expect(f.fetch).not.toHaveBeenCalled();
  });

  it("wires revocation only to the explicit profile logout button, not session callbacks", () => {
    expect(source).toMatch(/className="profile-logout" onClick=\{logoutRiderSession\}/);
    expect(source.match(/logoutRiderSession/g)).toHaveLength(2);
    expect(callbacks.match(/\/api\/v1\/auth\/employee\/logout/g)).toHaveLength(1);
  });
});
