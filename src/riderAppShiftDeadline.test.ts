/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compile } from "./test/offlineComponent";
import { withRequestDeadline } from "./requestDeadline";
import { parseRiderStartAcknowledgement, riderStartBlock, riderStartFailureMessage } from "./riderShiftStart";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let target: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "toggleShift") target = node;
  ts.forEachChild(node, visit);
}
visit(ast);
if (!target) throw new Error("toggleShift not found");
const activeSlot = { date: "2026-11-18", startTime: "12:00", endTime: "00:00", status: "active", riderId: "fixture-rider" };
const activeAck = { locationRequired: false, rider: { id: "fixture-rider", status: "available" }, shift: activeSlot };
function fixture() {
  const epoch = { current: 1 }, gps = { current: 1 };
  const token = { current: "mock-only" }, rider = { current: "fixture-rider" };
  const busy = vi.fn(), toast = vi.fn(), active = vi.fn(), sound = vi.fn(), refresh = vi.fn(), finish = vi.fn();
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(activeAck)));
  const capture = vi.fn(async () => ({ latitude: 0, longitude: 0, accuracy: 1 }));
  const publish = vi.fn(async () => {}), permission = vi.fn(async () => true);
  const invalidateIdentity = vi.fn();
  const notice = vi.fn(), current = vi.fn(), operations = vi.fn(), consent = vi.fn(), prime = vi.fn();
  const start = runInNewContext(compile(`${target!.getText(ast)}\ntoggleShift;`, "shift.ts"), {
    console, Date, Error, withRequestDeadline, AbortController, riderDataRequestTimeoutMs: 100,
    shiftActive: false, shiftBusy: false, riderId: "fixture-rider", apiToken: "mock-only",
    currentShift: { eligible: true, shift: { ...activeSlot, status: "assigned" } }, riderOperationalStatus: "offline",
    audioPreferences: { alertsEnabled: false }, startConsentOpen: true, shifts: [],
    riderSessionEpochRef: epoch, riderGpsSessionGenerationRef: gps,
    activeTokenRef: token, riderIdentityRef: rider,
    riderShiftSyncRef: { current: { beginStart: vi.fn(), finishStart: finish } }, shiftActiveRef: { current: false },
    parseRiderStartAcknowledgement, riderStartBlock, riderStartFailureMessage,
    apiOrigin: "https://offline.invalid", authHeaders: () => ({}), fetch: fetcher, captureRiderGps: capture,
    publishRiderLocation: publish, requestRiderNotificationPermission: permission,
    registerRiderPush: vi.fn(), syncShiftStartAlarms: vi.fn(), invalidateAccountIdentity: invalidateIdentity,
    setStartConsentOpen: consent, setShiftBusy: busy, setToast: toast, setShiftActive: active,
    setStartedShiftNotice: notice, setCurrentShift: current, setShowOperations: operations,
    primeRiderOrderAudio: prime, playRiderShiftStart: sound, audioContextRef: { current: null },
    loadRiderDataRef: { current: refresh },
  }) as (preferences?: { alertsEnabled: boolean }) => Promise<void>;
  return { start, epoch, gps, token, rider, busy, toast, active, sound, refresh, finish, fetcher, capture, publish,
    permission, invalidateIdentity, notice, current, operations, consent, prime };
}
afterEach(() => vi.useRealTimers());

describe("App shift start deadline — offline real handler", () => {
  it.each(["fetch", "body"])("settles an abort-ignoring %s at the deadline, releases busy, and only reads status", async stage => {
    vi.useFakeTimers();
    const f = fixture();
    let resolve!: (value: Response) => void;
    const late = new Promise<Response>(done => { resolve = done; });
    f.fetcher.mockImplementationOnce(() => stage === "fetch" ? late : Promise.resolve({
      ok: true, status: 200, json: () => new Promise(() => {}),
    } as Response));
    const work = f.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.busy).not.toHaveBeenCalledWith(false);
    await vi.advanceTimersByTimeAsync(101);
    await work;
    expect(f.fetcher.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(f.fetcher.mock.calls[0][1].signal!.aborted).toBe(true);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.active).not.toHaveBeenCalledWith(true);
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
    expect(f.finish).toHaveBeenCalledOnce();
    expect(f.refresh).toHaveBeenCalledOnce();
    expect(f.toast).toHaveBeenLastCalledWith(expect.stringContaining("no se repetirá el inicio automáticamente"));
    resolve(new Response(JSON.stringify(activeAck)));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.active).not.toHaveBeenCalledWith(true);
  });
  it("ignores a delayed network failure from the previous epoch without changing the new session", async () => {
    let reject!: (error: Error) => void;
    const f = fixture();
    f.fetcher.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
    const work = f.start();
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
    f.epoch.current++;
    reject(new Error("old request failed"));
    await work;
    expect(f.toast).not.toHaveBeenCalled();
    expect(f.busy.mock.calls).toEqual([[true]]);
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.finish).not.toHaveBeenCalled();
  });
  it.each([{}, { message: "Jornada iniciada" }])("keeps an incomplete 200 silent, then reads authoritative status: %j", async body => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await f.start();
    expect(f.toast).toHaveBeenLastCalledWith(expect.stringContaining("no ha confirmado"));
    expect(f.active).not.toHaveBeenCalledWith(true);
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.refresh).toHaveBeenCalledOnce();
  });
  it("accepts only a complete current-session ACK before announcing the active shift", async () => {
    const f = fixture();
    await f.start();
    expect(f.active).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
    expect(f.refresh).toHaveBeenCalledOnce();
  });
  it("preserves GPS freshness and assigned-slot guards", () => {
    const text = target!.getText(ast);
    expect(text.indexOf("captureRiderGps()")).toBeLessThan(text.indexOf("publishRiderLocation("));
    expect(text.indexOf("publishRiderLocation(")).toBeLessThan(text.indexOf("/shift/${endpoint}"));
    expect(text).toContain("riderStartBlock({ riderId, riderStatus: riderOperationalStatus, currentShift })");
    expect(text).toContain("riderShiftSyncRef.current.beginStart()");
    expect(text).toContain("parseRiderStartAcknowledgement(data, riderId)");
  });
});

function startChanges(f: ReturnType<typeof fixture>) {
  return Object.fromEntries(["busy", "toast", "active", "sound", "refresh", "finish", "invalidateIdentity", "notice", "current", "operations", "consent", "prime"]
    .map(name => [name, (f[name as keyof typeof f] as ReturnType<typeof vi.fn>).mock.calls.length]));
}
function changeStartOwnership(f: ReturnType<typeof fixture>, change: string) {
  if (change.startsWith("rider")) f.rider.current = "fixture-rider-B";
  if (change === "token-only") f.token.current = "mock-only-B";
  if (change === "rider-and-GPS" || change === "GPS-only") f.gps.current++;
}

describe("Start keeps its captured rider/token/GPS ownership through all await/catch/finally paths", () => {
  for (const change of ["rider-only", "rider-and-GPS", "token-only", "GPS-only"]) {
    it.each(["ACK", "HTTP-error", "network-error", "body"])(`start ${change} ignores a late %s without finishing B's start or refreshing`, async outcome => {
      const f = fixture();
      let resolve!: (value: Response) => void, reject!: (error: Error) => void, finishBody!: (value: unknown) => void;
      const request = new Promise<Response>((done, fail) => { resolve = done; reject = fail; });
      const body = new Promise<unknown>(done => { finishBody = done; });
      if (outcome === "body") f.fetcher.mockResolvedValueOnce({ ok: true, status: 200, json: () => body } as Response);
      else f.fetcher.mockImplementationOnce(() => request);
      const work = f.start();
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
      changeStartOwnership(f, change);
      const before = startChanges(f);
      if (outcome === "network-error") reject(new Error("A's late error"));
      else if (outcome === "body") finishBody(activeAck);
      else resolve(new Response(JSON.stringify(activeAck), { status: outcome === "ACK" ? 200 : 401 }));
      await work;
      expect(startChanges(f)).toEqual(before);
      expect(f.epoch.current).toBe(1);
      if (change !== "token-only") expect(f.token.current).toBe("mock-only");
      expect(f.busy).not.toHaveBeenCalledWith(false);
      expect(f.finish).not.toHaveBeenCalled();
      expect(f.refresh).not.toHaveBeenCalled();
    });
  }
  for (const stage of ["permission", "capture", "publish"] as const) {
    it.each(["resolve", "reject"])(`start ignores rider-only rebind during ${stage} %s before submitting`, async outcome => {
      const f = fixture();
      let resolve!: (value: never) => void, reject!: (error: Error) => void;
      const wait = new Promise<never>((done, fail) => { resolve = done; reject = fail; });
      f[stage].mockImplementationOnce(() => wait);
      const work = f.start({ alertsEnabled: stage === "permission" });
      await vi.waitFor(() => expect(f[stage]).toHaveBeenCalledOnce());
      changeStartOwnership(f, "rider-only");
      const before = startChanges(f);
      if (outcome === "reject") reject(new Error("A's late prerequisite error"));
      else resolve((stage === "capture" ? { latitude: 0, longitude: 0, accuracy: 1 } : true) as never);
      await work;
      expect(startChanges(f)).toEqual(before);
      expect(f.fetcher).not.toHaveBeenCalled();
      if (stage === "permission") expect(f.capture).not.toHaveBeenCalled();
      if (stage !== "publish") expect(f.publish).not.toHaveBeenCalled();
      expect(f.epoch.current).toBe(1);
      expect(f.token.current).toBe("mock-only");
    });
  }
});
