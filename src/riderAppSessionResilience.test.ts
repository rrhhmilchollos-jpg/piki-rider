/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountIdentitySession, parseEmployeeIdentity } from "./accountIdentity";
import { refreshRiderDataPanels } from "./riderDataRefresh";
import { normalizeRiderShift, parseRiderShiftSnapshot, riderSnapshotHasActiveShift, RiderShiftSync } from "./riderShiftSync";
import { riderResponseRequiresAuthentication } from "./apiAuthPolicy";
import { withRequestDeadline } from "./requestDeadline";
import { isRiderPwaOperationActive } from "./pwaOperationSafety";
import { compile } from "./test/offlineComponent";

// Run extracted AST callbacks with only synthetic fixtures. No App effects,
// browser, native GPS, credentials, or production transport are executed.
const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string): string {
  let found: ts.VariableDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!found?.initializer) throw new Error(`Callback not found: ${name}`);
  return `const ${found.getText(ast)};\n${name};`;
}
const refreshCode = callback("loadRiderData");
const officialSession = { rider: { id: "fixture-rider", status: "offline" }, employee: { id: "fixture-employee", name: "Fixture", role: "rider" } };
const slot = { date: "2026-11-18", startTime: "12:00", endTime: "00:00", status: "assigned" };
function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status }); }
function fixture() {
  const state: Record<string, unknown> = { setShifts: [], setHasSyncedSlots: false, setSlotsStatus: "loading", setSlotsError: "" };
  const setters: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of new Set([...refreshCode.matchAll(/\b(set[A-Z]\w*)\(/g)].map(match => match[1]))) {
    setters[name] = vi.fn((value: unknown) => { state[name] = typeof value === "function" ? value(state[name]) : value; });
  }
  const epoch = { current: 1 };
  const identitySession = new AccountIdentitySession("mock-only");
  const refs = {
    riderSessionEpochRef: epoch, activeTokenRef: { current: "mock-only" }, riderIdentityRef: { current: "fixture-rider" },
    riderRefreshInFlightRef: { current: false }, riderRefreshQueuedRef: { current: false },
    riderShiftSyncRef: { current: new RiderShiftSync() }, shiftActiveRef: { current: false }, loadRiderDataRef: { current: vi.fn() },
  };
  const sessionRequest = vi.fn(async () => response(200, officialSession));
  const slotsRequest = vi.fn(async () => response(200, { slots: [slot] }));
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(url.startsWith("https://offline.invalid/")).toBe(true);
    expect(init.signal).toBeDefined();
    if (url.endsWith("/session")) return sessionRequest();
    if (url.endsWith("/slots")) return slotsRequest();
    if (url.endsWith("/shift")) return response(200, { eligible: false, shift: null });
    return response(200, {});
  });
  const reset = vi.fn(() => { state.setShifts = []; state.setHasSyncedSlots = false; });
  const end = vi.fn();
  const invalidateIdentity = vi.fn();
  const refresh = runInNewContext(compile(refreshCode, "refresh.ts"), {
    ...refs, ...setters, apiToken: "mock-only", apiOrigin: "https://offline.invalid", authHeaders: () => ({}),
    useCallback: (fn: unknown) => fn, withRequestDeadline, AbortController, AbortSignal, riderDataRequestTimeoutMs: 100,
    fetch: fetcher, identitySession, parseEmployeeIdentity, riderResponseRequiresAuthentication,
    refreshRiderDataPanels, normalizeRiderShift, parseRiderShiftSnapshot, riderSnapshotHasActiveShift,
    invalidateAccountIdentity: invalidateIdentity, invalidateRiderGps: vi.fn(), resetRiderScopedState: reset, endRiderSession: end,
    isRiderGpsStatusBlocked: () => false, loadRiderAudioPreferences: () => ({}), markStoredTokenValidated: vi.fn(),
    window: { setTimeout: vi.fn() },
  }) as () => Promise<void>;
  return { refresh, state, setters, slotsRequest, sessionRequest, fetcher, epoch, reset, end, invalidateIdentity };
}
afterEach(() => vi.useRealTimers());

describe("App session and slots resilience — real callbacks, offline", () => {
  it.each(["503", "network", "empty-object", "null", "missing-list", "invalid-record", "invalid-json"])('preserves the last valid schedule after %s', async outcome => {
    const f = fixture();
    await f.refresh();
    const previous = f.state.setShifts;
    expect(f.state.setSlotsStatus).toBe("success");
    expect(f.state.setHasSyncedSlots).toBe(true);
    f.slotsRequest.mockImplementationOnce(async () => {
      if (outcome === "network") throw new TypeError("fixture offline");
      if (outcome === "invalid-json") return new Response("invalid-json");
      if (outcome === "503") return response(503, {});
      if (outcome === "null") return response(200, null);
      if (outcome === "missing-list") return response(200, { slots: null });
      if (outcome === "invalid-record") return response(200, { slots: [{}] });
      return response(200, {});
    });
    await f.refresh();
    expect(f.state.setShifts).toBe(previous);
    expect(f.state.setSlotsStatus).toBe("error");
    expect(f.state.setSlotsError).toBe("No se han podido sincronizar horarios");
    // Other panels are still independent; slots failure is not token expiry.
    expect(f.state.setStatus).toBe("ready");
    expect(f.end).not.toHaveBeenCalled();
  });
  it("only clears a previous schedule for a confirmed empty array, and recovers after retry", async () => {
    const f = fixture();
    await f.refresh();
    f.slotsRequest.mockResolvedValueOnce(response(200, {}));
    await f.refresh();
    f.slotsRequest.mockResolvedValueOnce(response(200, { slots: [] }));
    await f.refresh();
    expect(f.state.setShifts).toEqual([]);
    expect(f.state.setHasSyncedSlots).toBe(true);
    expect(f.state.setSlotsStatus).toBe("success");
    expect(f.state.setSlotsError).toBe("");
  });
  it("does not claim a valid empty schedule after the initial slots failure", async () => {
    const f = fixture();
    f.slotsRequest.mockResolvedValueOnce(response(503, {}));
    await f.refresh();
    expect(f.state.setHasSyncedSlots).toBe(false);
    expect(f.setters.setShifts).not.toHaveBeenCalled();
  });
  it.each([404, 503, 401, 403, 428])("reports generic session HTTP %s without discarding a proxy-affected token or schedule", async status => {
    const f = fixture();
    await f.refresh();
    const previous = f.state.setShifts;
    f.sessionRequest.mockResolvedValueOnce(new Response("proxy unavailable", { status }));
    await f.refresh();
    expect(f.state.setStatus).toBe("unavailable");
    expect(f.state.setSessionError).toEqual(expect.stringContaining(`HTTP ${status}`));
    expect(f.state.setShifts).toBe(previous);
    expect(f.reset).not.toHaveBeenCalled();
    expect(f.end).not.toHaveBeenCalled();
  });
  it.each(["code", "error"])("distinguishes the explicit unlinked %s from a generic 404", async key => {
    const f = fixture();
    f.sessionRequest.mockResolvedValueOnce(response(404, { [key]: "RIDER_ACCOUNT_NOT_LINKED" }));
    await f.refresh();
    expect(f.state.setSessionError).toEqual(expect.stringContaining("RIDER_ACCOUNT_NOT_LINKED"));
    expect(f.reset).toHaveBeenCalledOnce();
    expect(f.end).not.toHaveBeenCalled();
  });
  it("still ends an explicitly expired session", async () => {
    const f = fixture();
    f.sessionRequest.mockResolvedValueOnce(response(401, { error: "TOKEN_EXPIRED" }));
    await f.refresh();
    expect(f.end).toHaveBeenCalledOnce();
  });
  it("keeps rider-scoped data when a successful session response is malformed", async () => {
    const f = fixture();
    await f.refresh();
    const previous = f.state.setShifts;
    f.sessionRequest.mockResolvedValueOnce(response(200, {}));
    await f.refresh();
    expect(f.state.setStatus).toBe("unavailable");
    expect(f.state.setShifts).toBe(previous);
    expect(f.reset).not.toHaveBeenCalled();
  });
  it("ignores a delayed slots body after the session epoch changes", async () => {
    let finish!: (body: unknown) => void;
    const f = fixture();
    f.slotsRequest.mockResolvedValueOnce({ ok: true, status: 200, json: () => new Promise(done => { finish = done; }) } as Response);
    const work = f.refresh();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    f.epoch.current++;
    finish({ slots: [slot] });
    await work;
    expect(f.setters.setShifts).not.toHaveBeenCalled();
    expect(f.setters.setHasSyncedSlots).not.toHaveBeenCalled();
  });
  it("settles a stuck slots body and preserves its last valid schedule", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.refresh();
    const previous = f.state.setShifts;
    f.slotsRequest.mockResolvedValueOnce({ ok: true, status: 200, json: () => new Promise(() => {}) } as Response);
    const work = f.refresh();
    await vi.advanceTimersByTimeAsync(101);
    await work;
    expect(f.state.setShifts).toBe(previous);
    expect(f.state.setSlotsStatus).toBe("error");
  });
});

describe("App PWA and calendar source contracts", () => {
  it.each([false, true])("allows a logged-out idle update but defers while authBusy=%s", authBusy => {
    let effect: ts.ArrowFunction | undefined;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
        const candidate = node.arguments[0];
        if (candidate && ts.isArrowFunction(candidate) && candidate.getText(ast).includes("publishPwaOperationSafety")) effect = candidate;
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    const publish = vi.fn();
    runInNewContext(compile(`(${effect!.getText(ast)})();`, "safety.ts"), {
      publishPwaOperationSafety: publish, isRiderPwaOperationActive, apiToken: "", riderId: "", status: "checking", authBusy,
      activeOrder: undefined, shiftActive: false, orderActionBusy: false, shiftBusy: false, supportFormBusy: false,
      supportChatBusy: false, applicationStatus: "idle", startConsentOpen: false, formEditing: false,
    });
    expect(publish).toHaveBeenCalledExactlyOnceWith({ known: true, active: authBusy });
  });
  it("guards all calendar absence claims with a valid snapshot and wires visible retry buttons", () => {
    expect(source).toContain('hasSyncedSlots ? "Sin turno asignado" : "Horarios pendientes de confirmar"');
    expect(source).toContain('hasSyncedSlots ? "Sin turno asignado" : "Pendiente de sincronizar"');
    expect(source).toContain('hasSyncedSlots ? "Fleet no ha asignado un tramo para hoy."');
    expect(source).toContain('onClick={() => void loadRiderData()}>Reintentar horarios</button>');
    expect(source.match(/onBusyChange=\{setAuthBusy\}/g)).toHaveLength(2);
    expect(source).toContain('const [identitySession] = useState(() => new AccountIdentitySession(apiToken));');
    expect(source).toContain("identitySession.mayApplyRead(identityRead)");
  });
});
