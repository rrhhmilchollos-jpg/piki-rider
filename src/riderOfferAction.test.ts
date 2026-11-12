import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute only this action, not App imports/effects, a browser, GPS or a live API.
const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const start = source.indexOf("  async function acceptRiderOfferAction(orderId: string) {");
const end = source.indexOf("  async function confirmDelivery(", start);
if (start < 0 || end < 0) throw new Error("Acceptance action not found");
const action = ts.transpileModule(`${source.slice(start, end)}\nacceptRiderOfferAction;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture() {
  let resolve!: (value: { message: string }) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<{ message: string }>((done, fail) => { resolve = done; reject = fail; });
  const refs = { riderSessionEpochRef: { current: 1 }, activeTokenRef: { current: "fixture-token" }, riderIdentityRef: { current: "fixture-rider" } };
  const setToast = vi.fn();
  const setOrderActionBusy = vi.fn();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const loadRiderData = vi.fn().mockResolvedValue(undefined);
  const acceptRiderOffer = vi.fn().mockReturnValue(pending);
  const run = runInNewContext(action, {
    ...refs, apiToken: "fixture-token", riderId: "fixture-rider", orderActionBusy: false,
    acceptRiderOffer, setToast, setOrderActionBusy, loadRiderData,
    refreshOffersRef: { current: refresh },
  }) as (orderId: string) => Promise<void>;
  return { refs, resolve, reject, run, setToast, setOrderActionBusy, refresh, loadRiderData, acceptRiderOffer };
}

describe("Rider acceptance action session isolation", () => {
  it("refreshes authoritative offers after a valid ACK and releases the current action", async () => {
    const f = fixture();
    const run = f.run("fixture-order");
    f.resolve({ message: "Pedido aceptado" });
    await run;
    expect(f.acceptRiderOffer).toHaveBeenCalledExactlyOnceWith("fixture-token", "fixture-rider", "fixture-order");
    expect(f.refresh).toHaveBeenCalledOnce();
    expect(f.loadRiderData).toHaveBeenCalledOnce();
    expect(f.setOrderActionBusy.mock.calls).toEqual([[true], [false]]);
  });
  it.each(["ACK", "error"])("ignores a late %s after logout/relogin without clearing the new action's busy state", async (outcome) => {
    const f = fixture();
    const run = f.run("fixture-order");
    f.refs.riderSessionEpochRef.current++;
    // Same account/token still represents a different session epoch.
    if (outcome === "ACK") f.resolve({ message: "Old ACK" }); else f.reject(new Error("Old error"));
    await run;
    expect(f.setToast).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.loadRiderData).not.toHaveBeenCalled();
    expect(f.setOrderActionBusy.mock.calls).toEqual([[true]]);
  });
  it("does not apply an ACK to a rebound rider identity", async () => {
    const f = fixture();
    const run = f.run("fixture-order");
    f.refs.riderIdentityRef.current = "other-rider";
    f.resolve({ message: "Old ACK" });
    await run;
    expect(f.setToast).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.setOrderActionBusy.mock.calls).toEqual([[true]]);
  });
  it("refreshes after an uncertain result without repeating the mutation", async () => {
    const f = fixture();
    const run = f.run("fixture-order");
    f.reject(new DOMException("Resultado no confirmado", "TimeoutError"));
    await run;
    expect(f.acceptRiderOffer).toHaveBeenCalledOnce();
    expect(f.refresh).toHaveBeenCalledOnce();
    expect(f.loadRiderData).toHaveBeenCalledOnce();
    expect(f.setOrderActionBusy.mock.calls).toEqual([[true], [false]]);
  });
});
