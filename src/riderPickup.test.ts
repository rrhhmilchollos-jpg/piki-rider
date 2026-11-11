/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { compile } from "./test/offlineComponent";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let target: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "confirmPickup") target = node;
  ts.forEachChild(node, visit);
}
visit(ast);

function fixture(request: () => Promise<Response>, credential = "mock-only-pin") {
  let offers = [{ _id: "fixture-order", status: "ready_for_pickup", assignmentState: "assigned" }];
  const pending = new Map();
  const refresh = vi.fn(async () => {});
  const load = vi.fn(async () => {});
  const toast = vi.fn();
  const busy = vi.fn();
  const pickupState = vi.fn();
  const fetcher = vi.fn(request);
  const context: Record<string, unknown> = {
    console, Date, window: { prompt: () => credential }, orderActionBusy: false,
    apiOrigin: "https://mock.invalid", riderId: "fixture-rider", apiToken: "mock-only", authHeaders: () => ({}),
    setToast: toast, setOrderActionBusy: busy, pendingOrderStatesRef: { current: pending },
    setPickupRequest: pickupState,
    setOffers: (update: (previous: typeof offers) => typeof offers) => { offers = update(offers); },
    fetch: fetcher, loadRiderData: load, refreshOffersRef: { current: refresh },
  };
  expect(target).toBeDefined();
  runInNewContext(compile(target!.getText(ast), "pickup.ts") + "\nthis.confirmPickup = confirmPickup;", context);
  return { confirm: context.confirmPickup as (id: string) => Promise<void>, offers: () => offers,
    pending, refresh, load, toast, busy, pickupState, fetcher };
}
function response(status: number, data: unknown) { return new Response(JSON.stringify(data), { status }); }

describe("confirmPickup real function — offline AST harness", () => {
  it("keeps Partner phase while the request is pending, then commits only after 2xx", async () => {
    let resolve!: (value: Response) => void;
    const f = fixture(() => new Promise((done) => { resolve = done; }));
    const work = f.confirm("fixture-order");
    expect(f.offers()[0].status).toBe("ready_for_pickup"); expect(f.pending.size).toBe(0);
    expect(f.toast).toHaveBeenCalledWith(expect.stringContaining("Aún no está confirmada"));
    expect(f.pickupState).toHaveBeenLastCalledWith({ orderId: "fixture-order", status: "sending" });
    resolve(response(200, { order: { status: "on_the_way" } })); await work;
    expect(f.offers()[0].status).toBe("on_the_way"); expect(f.pending.size).toBe(1);
    expect(f.pickupState).toHaveBeenLastCalledWith(null);
    expect(f.refresh).toHaveBeenCalledTimes(1); expect(f.busy).toHaveBeenLastCalledWith(false);
  });
  it("422 invalid PIN never shows a confirmed route and immediately refreshes offers", async () => {
    const f = fixture(async () => response(422, { error: "PICKUP_QR_INVALID" })); await f.confirm("fixture-order");
    expect(f.offers()[0].status).toBe("ready_for_pickup"); expect(f.pending.size).toBe(0);
    expect(f.refresh).toHaveBeenCalledTimes(1); expect(f.load).toHaveBeenCalledTimes(1);
    expect(f.refresh.mock.invocationCallOrder[0]).toBeLessThan(f.load.mock.invocationCallOrder[0]);
    expect(f.toast).toHaveBeenLastCalledWith("PICKUP_QR_INVALID");
    expect(f.pickupState).toHaveBeenLastCalledWith(null);
  });
  it("ambiguous timeout refreshes without optimism or repeating a mutation", async () => {
    const f = fixture(async () => { throw new Error("Fixture timeout"); }); await f.confirm("fixture-order");
    expect(f.offers()[0].status).toBe("ready_for_pickup"); expect(f.pending.size).toBe(0);
    expect(f.toast).toHaveBeenLastCalledWith(expect.stringContaining("pendiente de verificar"));
    expect(f.pickupState).toHaveBeenLastCalledWith({ orderId: "fixture-order", status: "verifying" });
    expect(f.refresh).toHaveBeenCalledTimes(1); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("honours successful 2xx without an order payload", async () => {
    const f = fixture(async () => response(200, {})); await f.confirm("fixture-order");
    expect(f.offers()[0].status).toBe("on_the_way"); expect(f.pending.size).toBe(1);
  });
  it("does not submit a missing PIN or start any refresh", async () => {
    const f = fixture(async () => response(200, {}), ""); await f.confirm("fixture-order");
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled();
  });
});
