/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { compile } from "./test/offlineComponent";
import { parseRiderStartAcknowledgement, riderStartBlock, riderStartFailureMessage } from "./riderShiftStart";
import { madridInstant } from "./shiftStartAlarms";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let target: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "toggleShift") target = node;
  ts.forEachChild(node, visit);
}
visit(ast);
const officialShift = { date: "2026-11-12", startTime: "12:00", endTime: "00:00", status: "active", riderId: "fixture-rider" };
const officialAck = { locationRequired: false, rider: { id: "fixture-rider", status: "available" }, shift: officialShift };
function fixture(request: () => Promise<Response>) {
  const toast = vi.fn();
  const sound = vi.fn();
  const active = vi.fn();
  const notice = vi.fn();
  const refresh = vi.fn();
  const fetcher = vi.fn(request);
  const context: Record<string, unknown> = {
    console, Date, Error, shiftActive: false, shiftBusy: false, riderId: "fixture-rider", apiToken: "mock-only",
    parseRiderStartAcknowledgement, riderStartBlock, riderStartFailureMessage,
    apiOrigin: "https://mock.invalid", authHeaders: () => ({}),
    currentShift: { eligible: true, shift: { ...officialShift, status: "planned" } },
    riderOperationalStatus: "offline", isRiderGpsStatusBlocked: () => false,
    startConsentOpen: true, audioPreferences: { alertsEnabled: true, volume: 0.5 }, shifts: [],
    riderGpsSessionGenerationRef: { current: 1 }, riderSessionEpochRef: { current: 1 },
    riderShiftSyncRef: { current: { beginStart: vi.fn(), finishStart: vi.fn() } },
    shiftActiveRef: { current: false }, audioContextRef: { current: null },
    setToast: toast, setShiftBusy: vi.fn(), setStartConsentOpen: vi.fn(),
    requestRiderNotificationPermission: vi.fn(async () => true), registerRiderPush: vi.fn(), syncShiftStartAlarms: vi.fn(),
    captureRiderGps: vi.fn(async () => ({ latitude: 0, longitude: 0, accuracy: 1 })),
    publishRiderLocation: vi.fn(async () => undefined), fetch: fetcher,
    setShiftActive: active, setStartedShiftNotice: notice, setCurrentShift: vi.fn(), setShowOperations: vi.fn(),
    primeRiderOrderAudio: vi.fn(), playRiderShiftStart: sound, loadRiderDataRef: { current: refresh },
  };
  expect(target).toBeDefined();
  runInNewContext(compile(target!.getText(ast), "start.ts") + "\nthis.toggleShift = toggleShift;", context);
  return { start: context.toggleShift as () => Promise<void>, toast, sound, active, notice, refresh, fetcher, context };
}
function response(status: number, data: unknown) { return new Response(JSON.stringify(data), { status }); }

describe("toggleShift real handler — offline confirmation contract", () => {
  it("does not announce or play a successful start for an empty HTTP 200", async () => {
    const f = fixture(async () => response(200, {}));
    await f.start();
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.active).not.toHaveBeenCalledWith(true);
    expect(f.notice).not.toHaveBeenCalledWith(true);
  });
  it("does not repeat a success message when the acknowledgement is incomplete", async () => {
    const f = fixture(async () => response(200, { message: "Jornada iniciada" }));
    await f.start();
    expect(f.toast).toHaveBeenLastCalledWith(expect.stringContaining("no ha confirmado"));
    expect(f.sound).not.toHaveBeenCalled();
  });
  it.each(["no-slot", "pending"])("does not use a reminder or local time to bypass %s", async (blocker) => {
    const f = fixture(async () => response(200, officialAck));
    if (blocker === "no-slot") f.context.currentShift = { eligible: false, shift: null };
    else f.context.riderOperationalStatus = "pending";
    await f.start();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.context.captureRiderGps).not.toHaveBeenCalled();
    expect(f.sound).not.toHaveBeenCalled();
  });
  it("does not turn a planned slot in HTTP 200 into an active shift", async () => {
    const f = fixture(async () => response(200, { ...officialAck, shift: { ...officialShift, status: "planned" } }));
    await f.start();
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.active).not.toHaveBeenCalledWith(true);
  });
  it("keeps the start pending and silent until the official active acknowledgement arrives", async () => {
    let resolve!: (value: Response) => void;
    const f = fixture(() => new Promise(done => { resolve = done; }));
    const work = f.start();
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.active).not.toHaveBeenCalledWith(true);
    resolve(response(200, officialAck));
    await work;
    expect(f.active).toHaveBeenCalledWith(true);
    expect(f.sound).toHaveBeenCalledTimes(1);
    expect(f.active.mock.invocationCallOrder[0]).toBeLessThan(f.sound.mock.invocationCallOrder[0]);
  });
  it("keeps a GPS denial silent and does not submit start", async () => {
    const f = fixture(async () => response(200, officialAck));
    f.context.captureRiderGps = vi.fn(async () => { throw new Error("Permiso GPS denegado"); });
    await f.start();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.toast).toHaveBeenLastCalledWith("Permiso GPS denegado");
  });
  it.each([
    [409, { error: "FRESH_LOCATION_REQUIRED", locationRequired: true }],
    [409, { error: "SHIFT_OUTSIDE_SCHEDULE" }],
    [403, { error: "RIDER_ACCESS_DENIED" }],
    [200, { ...officialAck, locationRequired: true }],
  ])("keeps rejected HTTP %s starts silent", async (status, body) => {
    const f = fixture(async () => response(status as number, body));
    await f.start();
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.active).not.toHaveBeenCalledWith(true);
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });
  it("does not announce a response for a previous GPS/session generation", async () => {
    const f = fixture(async () => {
      (f.context.riderGpsSessionGenerationRef as { current: number }).current += 1;
      return response(200, officialAck);
    });
    await f.start();
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.active).not.toHaveBeenCalledWith(true);
  });
});

describe("official start acknowledgement and known blockers", () => {
  it("keeps the noon reminder at 11:00 UTC and midnight at 23:00 UTC in Madrid winter time", () => {
    expect(madridInstant("2026-11-12", "12:00")?.toISOString()).toBe("2026-11-12T11:00:00.000Z");
    expect(madridInstant("2026-11-13", "00:00")?.toISOString()).toBe("2026-11-12T23:00:00.000Z");
  });
  it.each(["available", "busy"])("accepts the API's %s rider with an active 12–00 slot", (status) => {
    expect(parseRiderStartAcknowledgement({ ...officialAck, rider: { ...officialAck.rider, status } }, "fixture-rider"))
      .toMatchObject({ date: "2026-11-12", start: "12:00", end: "00:00", status: "active" });
  });
  it.each([
    null, {}, { message: "Jornada iniciada" },
    { ...officialAck, rider: { id: "another-rider", status: "available" } },
    { ...officialAck, rider: { id: "fixture-rider", status: "offline" } },
    { ...officialAck, shift: { ...officialShift, riderId: "another-rider" } },
    { ...officialAck, shift: { ...officialShift, status: "completed" } },
    { ...officialAck, error: "BLOCKED" },
    { ...officialAck, locationRequired: undefined },
    { ...officialAck, success: false },
    { ...officialAck, shift: { ...officialShift, date: "2026-11-31" } },
    { ...officialAck, shift: { ...officialShift, startTime: "25:00" } },
  ])("rejects incomplete or conflicting success: %j", (body) => {
    expect(parseRiderStartAcknowledgement(body, "fixture-rider")).toBeNull();
  });
  it("distinguishes an unlinked session, non-operative rider, and no API slot", () => {
    expect(riderStartBlock({ riderId: "", riderStatus: "", currentShift: { eligible: false } })?.label).toBe("SESIÓN NO VALIDADA");
    expect(riderStartBlock({ riderId: "fixture", riderStatus: "pending", currentShift: { eligible: true } })?.label).toBe("ALTA NO OPERATIVA");
    expect(riderStartBlock({ riderId: "fixture", riderStatus: "offline", currentShift: { eligible: false } })?.message).toContain("recordatorio no inicia");
    expect(riderStartBlock({ riderId: "fixture", riderStatus: "offline", currentShift: { eligible: true } })).toBeNull();
  });
  it("maps actual authorization and GPS errors without claiming an out-of-hours cause", () => {
    expect(riderStartFailureMessage({ error: "RIDER_ACCESS_DENIED" })).toContain("no tiene acceso");
    expect(riderStartFailureMessage({ error: "FRESH_LOCATION_REQUIRED" })).toContain("GPS real");
  });
});
