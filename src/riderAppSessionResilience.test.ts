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
import { compile, findNode, jsx } from "./test/offlineComponent";

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
const resetCode = callback("resetRiderScopedState");
const officialSession = { rider: { id: "fixture-rider", status: "offline" }, employee: { id: "fixture-employee", name: "Fixture", role: "rider" } };
const slot = { date: "2026-11-18", startTime: "12:00", endTime: "00:00", status: "assigned" };
const activeShift = { eligible: true, shift: { ...slot, status: "active" } };
function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status }); }
function fixture() {
  const state: Record<string, unknown> = {
    setShifts: [], setHasSyncedSlots: false, setSlotsStatus: "loading", setSlotsError: "",
    setHasConfirmedShift: false, setShiftActive: false, setShiftSyncError: "",
  };
  const setters: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of new Set([...`${refreshCode}\n${resetCode}`.matchAll(/\b(set[A-Z]\w*)\(/g)].map(match => match[1]))) {
    setters[name] = vi.fn((value: unknown) => { state[name] = typeof value === "function" ? value(state[name]) : value; });
  }
  const epoch = { current: 1 };
  const identitySession = new AccountIdentitySession("mock-only");
  const refs = {
    riderSessionEpochRef: epoch, activeTokenRef: { current: "mock-only" }, riderIdentityRef: { current: "fixture-rider" },
    riderRefreshInFlightRef: { current: false }, riderRefreshQueuedRef: { current: false },
    riderShiftSyncRef: { current: new RiderShiftSync() }, shiftActiveRef: { current: false }, loadRiderDataRef: { current: vi.fn() },
    riderOrdersRef: { current: [] }, cancelledOrderIdsRef: { current: new Set() },
    pendingOrderStatesRef: { current: new Map() }, knownOfferIdsRef: { current: null }, assignedOrderRef: { current: false },
    lastOfferAtRef: { current: 0 }, lastMobilityAlertRef: { current: "" }, lastAlertAtRef: { current: 0 },
  };
  const sessionRequest = vi.fn(async () => response(200, officialSession));
  const slotsRequest = vi.fn(async () => response(200, { slots: [slot] }));
  const shiftRequest = vi.fn(async () => response(200, { eligible: false, shift: null }));
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(url.startsWith("https://offline.invalid/")).toBe(true);
    expect(init.signal).toBeDefined();
    expect(init.method ?? "GET").toBe("GET");
    if (url.endsWith("/session")) return sessionRequest();
    if (url.endsWith("/slots")) return slotsRequest();
    if (url.endsWith("/shift")) return shiftRequest();
    return response(200, {});
  });
  const end = vi.fn();
  const invalidateIdentity = vi.fn();
  const invalidateGps = vi.fn();
  const globals = {
    ...refs, ...setters, apiToken: "mock-only", apiOrigin: "https://offline.invalid", authHeaders: () => ({}),
    useCallback: (fn: unknown) => fn, withRequestDeadline, AbortController, AbortSignal, riderDataRequestTimeoutMs: 100,
    fetch: fetcher, identitySession, parseEmployeeIdentity, riderResponseRequiresAuthentication,
    refreshRiderDataPanels, normalizeRiderShift, parseRiderShiftSnapshot, riderSnapshotHasActiveShift,
    invalidateAccountIdentity: invalidateIdentity, invalidateRiderGps: invalidateGps, endRiderSession: end,
    isRiderGpsStatusBlocked: () => false, loadRiderAudioPreferences: () => ({}), markStoredTokenValidated: vi.fn(),
    riderArrivalAlerts: { reset: vi.fn() }, cancelRiderPushRegistration: vi.fn(), clearRiderNativeAlerts: vi.fn(),
    clearShiftStartAlarms: vi.fn(), defaultRiderAudioPreferences: {},
    window: { setTimeout: vi.fn() },
  };
  const reset = vi.fn(runInNewContext(compile(resetCode, "reset.ts"), globals) as () => void);
  const refresh = runInNewContext(compile(refreshCode, "refresh.ts"), { ...globals, resetRiderScopedState: reset }) as () => Promise<void>;
  return { refresh, state, setters, slotsRequest, shiftRequest, sessionRequest, fetcher, epoch, reset, end, invalidateIdentity, invalidateGps, refs };
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
  it.each([401, 403])("ends the current session on an explicit API authentication failure (HTTP %s)", async status => {
    const f = fixture();
    f.sessionRequest.mockResolvedValueOnce(response(status, { error: "AUTHENTICATION_REQUIRED" }));
    await f.refresh();
    expect(f.end).toHaveBeenCalledExactlyOnceWith("La API requiere que inicies sesión de nuevo para recibir ofertas.");
  });
  it.each([401, 403].flatMap(status => ["Unauthorized", "unauthorized", "UNAUTHORIZED", "AUTHENTICATION_REQUIRED:UPSTREAM", "AUTHENTICATION_REQUIRED_UPSTREAM"].map(error => ({ status, error }))))("does not log out on ambiguous HTTP $status error $error", async ({ status, error }) => {
    const f = fixture();
    await f.refresh();
    const previous = f.state.setShifts;
    f.sessionRequest.mockResolvedValueOnce(response(status, { error }));
    await f.refresh();
    expect(f.end).not.toHaveBeenCalled();
    expect(f.reset).not.toHaveBeenCalled();
    expect(f.state.setShifts).toBe(previous);
    expect(f.state.setStatus).toBe("unavailable");
  });
  it.each([401, 403])("does not end a session for a proxy's message-only HTTP %s", async status => {
    const f = fixture();
    f.sessionRequest.mockResolvedValueOnce(response(status, { message: "Unauthorized" }));
    await f.refresh();
    expect(f.end).not.toHaveBeenCalled();
    expect(f.reset).not.toHaveBeenCalled();
  });
  it.each([401, 403])("ignores a late explicit authentication body after the session epoch changes (HTTP %s)", async status => {
    const f = fixture();
    let finish!: (body: unknown) => void;
    f.sessionRequest.mockResolvedValueOnce({ ok: false, status, json: () => new Promise(done => { finish = done; }) } as Response);
    const work = f.refresh();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    f.epoch.current++;
    finish({ error: "AUTHENTICATION_REQUIRED" });
    await work;
    expect(f.end).not.toHaveBeenCalled();
    expect(f.reset).not.toHaveBeenCalled();
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

const shiftFailures = ["503", "network", "empty-object", "null", "missing-shift", "invalid-status", "invalid-json"];
function failShift(f: ReturnType<typeof fixture>, outcome: string) {
  f.shiftRequest.mockImplementationOnce(async () => {
    if (outcome === "network") throw new TypeError("fixture offline");
    if (outcome === "invalid-json") return new Response("invalid-json");
    if (outcome === "503") return response(503, {});
    if (outcome === "null") return response(200, null);
    if (outcome === "missing-shift") return response(200, { eligible: false });
    if (outcome === "invalid-status") return response(200, { eligible: true, shift: { status: "unknown" } });
    return response(200, {});
  });
}

describe("App shift snapshot recovery — real callbacks, offline", () => {
  it.each(shiftFailures)("does not confuse an initial %s with an inactive jornada and recovers by reading", async outcome => {
    const f = fixture();
    failShift(f, outcome);
    await f.refresh();
    expect(f.state.setStatus).toBe("ready");
    expect(f.state.setHasSyncedSlots).toBe(true);
    expect(f.state.setHasConfirmedShift).toBe(false);
    expect(f.setters.setCurrentShift).not.toHaveBeenCalled();
    expect(f.setters.setShiftActive).not.toHaveBeenCalled();
    expect(f.state.setShiftSyncError).toEqual(expect.stringContaining("No se ha podido confirmar tu jornada"));
    expect(f.end).not.toHaveBeenCalled();
    expect(f.reset).not.toHaveBeenCalled();
    expect(f.invalidateGps).not.toHaveBeenCalled();
    f.shiftRequest.mockResolvedValueOnce(response(200, activeShift));
    await f.refresh();
    expect(f.state.setHasConfirmedShift).toBe(true);
    expect(f.state.setShiftActive).toBe(true);
    expect(f.refs.shiftActiveRef.current).toBe(true);
    expect(f.state.setShiftSyncError).toBe("");
    expect(f.fetcher.mock.calls.every(([url, init]) => !url.endsWith("/start") && !url.endsWith("/end") && !init.method)).toBe(true);
  });
  it("confirms an authoritative inactive snapshot without starting a shift", async () => {
    const f = fixture();
    await f.refresh();
    expect(f.state.setHasConfirmedShift).toBe(true);
    expect(f.state.setShiftActive).toBe(false);
    expect(f.state.setCurrentShift).toMatchObject({ eligible: false, shift: null });
    expect(f.state.setShiftSyncError).toBe("");
  });
  it.each(shiftFailures)("preserves the active snapshot and GPS after %s, with a persistent error until a valid retry", async outcome => {
    const f = fixture();
    f.shiftRequest.mockResolvedValueOnce(response(200, activeShift));
    await f.refresh();
    const previous = f.state.setCurrentShift;
    const changes = f.setters.setShiftActive.mock.calls.length;
    failShift(f, outcome);
    await f.refresh();
    expect(f.state.setCurrentShift).toBe(previous);
    expect(f.state.setHasConfirmedShift).toBe(true);
    expect(f.state.setShiftActive).toBe(true);
    expect(f.refs.shiftActiveRef.current).toBe(true);
    expect(f.setters.setShiftActive).toHaveBeenCalledTimes(changes);
    expect(f.invalidateGps).not.toHaveBeenCalled();
    expect(f.state.setShiftSyncError).not.toBe("");
    expect(f.end).not.toHaveBeenCalled();
    f.shiftRequest.mockResolvedValueOnce(response(200, activeShift));
    await f.refresh();
    expect(f.state.setShiftSyncError).toBe("");
    expect(f.state.setShiftActive).toBe(true);
    expect(f.invalidateGps).not.toHaveBeenCalled();
  });
  it("only a valid current snapshot can close a previously active shift", async () => {
    const f = fixture();
    f.shiftRequest.mockResolvedValueOnce(response(200, activeShift));
    await f.refresh();
    f.shiftRequest.mockResolvedValueOnce(response(200, { eligible: false, shift: { ...slot, status: "completed" } }));
    await f.refresh();
    expect(f.state.setHasConfirmedShift).toBe(true);
    expect(f.state.setShiftActive).toBe(false);
    expect(f.invalidateGps).toHaveBeenCalledOnce();
    expect(f.state.setToast).toBe("La API ha confirmado el cierre de tu jornada.");
  });
  it.each(["epoch", "token", "rider", "starting", "revision"].flatMap(change => ["body", "network"].map(outcome => ({ change, outcome }))))("ignores $outcome after $change changes without confirming or changing the error", async ({ change, outcome }) => {
    const f = fixture();
    let resolve!: (body: unknown) => void, reject!: (error: Error) => void;
    const pending = new Promise<unknown>((done, fail) => { resolve = done; reject = fail; });
    if (outcome === "body") f.shiftRequest.mockResolvedValueOnce({ ok: true, status: 200, json: () => pending } as Response);
    else f.shiftRequest.mockImplementationOnce(async () => await pending as Response);
    const work = f.refresh();
    await vi.waitFor(() => expect(f.shiftRequest).toHaveBeenCalledOnce());
    if (change === "epoch") f.epoch.current++;
    if (change === "token") f.refs.activeTokenRef.current = "mock-B";
    if (change === "rider") f.refs.riderIdentityRef.current = "fixture-B";
    if (change === "starting") f.refs.riderShiftSyncRef.current.beginStart();
    if (change === "revision") {
      f.refs.riderShiftSyncRef.current.beginStart();
      f.refs.riderShiftSyncRef.current.finishStart();
    }
    f.state.setShiftSyncError = "B's current error";
    if (outcome === "body") resolve(activeShift);
    else reject(new Error("A's late failure"));
    await work;
    for (const name of ["setHasConfirmedShift", "setShiftActive", "setCurrentShift", "setShiftSyncError"]) expect(f.setters[name]).not.toHaveBeenCalled();
    expect(f.state.setShiftSyncError).toBe("B's current error");
    expect(f.invalidateGps).not.toHaveBeenCalled();
    expect(f.end).not.toHaveBeenCalled();
  });
  it.each(["fetch", "body"].flatMap(stage => [false, true].map(warm => ({ stage, warm }))))("settles an abort-ignoring $stage with warm=$warm and ignores its late result", async ({ stage, warm }) => {
    vi.useFakeTimers();
    const f = fixture();
    if (warm) {
      f.shiftRequest.mockResolvedValueOnce(response(200, activeShift));
      await f.refresh();
    }
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>(done => { resolve = done; });
    if (stage === "body") f.shiftRequest.mockResolvedValueOnce({ ok: true, status: 200, json: () => pending } as Response);
    else f.shiftRequest.mockImplementationOnce(async () => await pending as Response);
    const work = f.refresh();
    await vi.advanceTimersByTimeAsync(101);
    await work;
    expect(f.refs.riderRefreshInFlightRef.current).toBe(false);
    expect(f.state.setShiftActive).toBe(warm);
    expect(f.state.setHasConfirmedShift).toBe(warm);
    expect(f.state.setShiftSyncError).not.toBe("");
    expect(f.invalidateGps).not.toHaveBeenCalled();
    const before = JSON.stringify(f.state);
    resolve(stage === "body" ? { eligible: false, shift: null } : response(200, { eligible: false, shift: null }));
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.stringify(f.state)).toBe(before);
    await f.refresh();
    expect(f.state.setShiftSyncError).toBe("");
    expect(f.state.setHasConfirmedShift).toBe(true);
  });
  it("resets confirmation and errors on session replacement instead of reusing the previous inactive snapshot", async () => {
    const f = fixture();
    await f.refresh();
    expect(f.state.setHasConfirmedShift).toBe(true);
    f.state.setShiftSyncError = "A's error";
    f.epoch.current++;
    f.reset();
    expect(f.state.setHasConfirmedShift).toBe(false);
    expect(f.state.setShiftSyncError).toBe("");
    failShift(f, "503");
    await f.refresh();
    expect(f.state.setHasConfirmedShift).toBe(false);
  });
  it.each([false, true])("rebinds to B with a fresh scoped read revision, valid B snapshot=%s", async valid => {
    const f = fixture();
    f.shiftRequest.mockResolvedValueOnce(response(200, activeShift));
    await f.refresh();
    f.sessionRequest.mockResolvedValueOnce(response(200, { ...officialSession, rider: { ...officialSession.rider, id: "fixture-B" } }));
    if (valid) f.shiftRequest.mockResolvedValueOnce(response(200, { eligible: false, shift: null }));
    else failShift(f, "503");
    await f.refresh();
    expect(f.reset).toHaveBeenCalledOnce();
    expect(f.refs.riderIdentityRef.current).toBe("fixture-B");
    expect(f.state.setHasConfirmedShift).toBe(valid);
    expect(f.state.setShiftActive).toBe(false);
    expect(f.state.setShiftSyncError === "").toBe(valid);
    expect(f.fetcher.mock.calls.some(([url]) => url.endsWith("/fixture-B/shift"))).toBe(true);
  });
});

function pwaSafety(overrides: Record<string, unknown> = {}) {
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
    publishPwaOperationSafety: publish, isRiderPwaOperationActive, apiToken: "mock-only", riderId: "fixture-rider", status: "ready",
    hasConfirmedShift: false, authBusy: false, activeOrder: undefined, shiftActive: false, orderActionBusy: false, shiftBusy: false,
    supportFormBusy: false, supportChatBusy: false, applicationStatus: "idle", startConsentOpen: false, formEditing: false, ...overrides,
  });
  return publish;
}

describe("App PWA and calendar source contracts", () => {
  it.each([false, true])("allows a logged-out idle update but defers while authBusy=%s", authBusy => {
    const publish = pwaSafety({ apiToken: "", riderId: "", status: "checking", authBusy });
    expect(publish).toHaveBeenCalledExactlyOnceWith({ known: true, active: authBusy });
  });
  it.each([false, true].flatMap(hasConfirmedShift => [false, true].map(shiftActive => ({ hasConfirmedShift, shiftActive }))))("requires confirmation=$hasConfirmedShift despite session ready and active=$shiftActive", ({ hasConfirmedShift, shiftActive }) => {
    expect(pwaSafety({ hasConfirmedShift, shiftActive })).toHaveBeenCalledExactlyOnceWith({ known: hasConfirmedShift, active: shiftActive });
  });
  it.each(["authBusy", "orderActionBusy", "shiftBusy", "supportFormBusy", "supportChatBusy", "startConsentOpen", "formEditing"])("keeps the previous %s safety guard after shift confirmation", guard => {
    expect(pwaSafety({ hasConfirmedShift: true, [guard]: true })).toHaveBeenCalledExactlyOnceWith({ known: true, active: true });
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

describe("App shift recovery UI — real AST, no effects", () => {
  it.each(["", "No se ha podido confirmar tu jornada."])("shows recovery and a GET retry without absence claims or a start CTA: %s", shiftSyncError => {
    let recovery: ts.IfStatement | undefined;
    function visit(node: ts.Node) {
      if (ts.isIfStatement(node) && node.expression.getText(ast) === "!hasConfirmedShift" && ts.isReturnStatement(node.thenStatement)) recovery = node;
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(recovery!.pos).toBeLessThan(source.indexOf("<ActiveShiftScreen"));
    const refresh = vi.fn();
    const tree = runInNewContext(compile(`function render() { ${callback("sessionSyncNotice")} ${callback("shiftSyncNotice")} ${recovery!.getText(ast)} } render();`, "recovery.tsx"), {
      exports: {}, require: (name: string) => { if (name === "react/jsx-runtime") return jsx; throw new Error(`Unmocked dependency: ${name}`); },
      hasConfirmedShift: false, sessionError: "", shiftSyncError, loadRiderData: refresh,
    });
    const text = JSON.stringify(tree);
    expect(text).toContain("Recuperando jornada");
    expect(text).not.toMatch(/INICIAR JORNADA|Empezar sesión|Jornada cerrada|Fuera de jornada|No estás disponible|Sin turno asignado/);
    if (shiftSyncError) expect(findNode(tree, node => node.props.role === "alert")).toBeDefined();
    const retry = findNode(tree, node => node.tag === "button" && node.props.children === "Reintentar jornada");
    expect(retry).toBeDefined();
    (retry!.props.onClick as () => void)();
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("wires the same persistent error/retry into both the active screen and the operations panel", () => {
    expect(source.match(/\{shiftSyncNotice\}/g)).toHaveLength(2);
    expect(source).toContain('{shiftSyncNotice || <button type="button" className="secondary-button" onClick={() => void loadRiderData()}>Reintentar jornada</button>}');
  });
});

describe("App SSE authentication callback — current session only", () => {
  let effect: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
      const candidate = node.arguments[0];
      if (candidate && ts.isArrowFunction(candidate) && candidate.getText(ast).includes("connectPikiRealtime")) effect = candidate;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!effect) throw new Error("Real SSE effect not found");

  it.each([401, 403].flatMap(status => ["current", "epoch", "token", "rider"].map(change => ({ status, change }))))("HTTP $status ends only the $change captured session", ({ status, change }) => {
    const epoch = { current: 1 }, token = { current: "mock-A" }, rider = { current: "rider-A" };
    const endRiderSession = vi.fn();
    let input!: { onAuthExpired: (status: number) => void };
    runInNewContext(compile(`(${effect!.getText(ast)})();`, "sse-effect.ts"), {
      apiOrigin: "https://offline.invalid", apiToken: "mock-A", riderId: "rider-A",
      riderSessionEpochRef: epoch, activeTokenRef: token, riderIdentityRef: rider,
      endRiderSession, connectPikiRealtime: (value: typeof input) => { input = value; },
    });
    if (change === "epoch") epoch.current++;
    if (change === "token") token.current = "mock-B";
    if (change === "rider") rider.current = "rider-B";
    input.onAuthExpired(status);
    if (change === "current") expect(endRiderSession).toHaveBeenCalledExactlyOnceWith("La API requiere que inicies sesión de nuevo para recibir ofertas.");
    else expect(endRiderSession).not.toHaveBeenCalled();
  });
});
