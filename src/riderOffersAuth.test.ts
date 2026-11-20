/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { requiresRiderAuthentication } from "./apiAuthPolicy";
import { parseRiderOffersSnapshot } from "./riderOffersSync";
import { compile } from "./test/offlineComponent";

// Execute the real offers effect, but replace its scheduler and all I/O with
// offline mocks. Its request callback and session-epoch guards are unchanged.
const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.ArrowFunction | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const candidate = node.arguments[0];
    if (candidate && ts.isArrowFunction(candidate) && candidate.getText(ast).includes("createRiderOffersSync")) effect = candidate;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!effect) throw new Error("Real offers effect not found");
const effectCode = compile(`(${effect.getText(ast)})();`, "offers-effect.ts");

type SyncInput = { request: (signal: AbortSignal) => Promise<unknown> };
function fixture(response: Response | Promise<Response>) {
  const epoch = { current: 1 }, token = { current: "mock-A" }, rider = { current: "fixture-rider" };
  const fetcher = vi.fn(async () => response);
  const end = vi.fn(), invalidateIdentity = vi.fn();
  let input!: SyncInput;
  runInNewContext(effectCode, {
    apiOrigin: "https://offline.invalid", apiToken: "mock-A", riderId: "fixture-rider",
    riderSessionEpochRef: epoch, activeTokenRef: token, riderIdentityRef: rider,
    refreshOffersRef: { current: null },
    fetch: fetcher, authHeaders: () => ({}), requiresRiderAuthentication, parseRiderOffersSnapshot,
    endRiderSession: end, invalidateAccountIdentity: invalidateIdentity,
    createRiderOffersSync: (value: SyncInput) => { input = value; return { refresh: () => Promise.resolve(), dispose: () => {} }; },
    document: { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() },
    window: { setInterval: vi.fn(), clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    DOMException,
  });
  return { request: input.request, fetcher, end, invalidateIdentity, epoch, token, rider };
}

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
describe("offers authentication policy — real callback, offline", () => {
  it.each([401, 403].flatMap(status => ["Unauthorized", "unauthorized", "UNAUTHORIZED", "AUTHENTICATION_REQUIRED:UPSTREAM", "AUTHENTICATION_REQUIRED_UPSTREAM"].map(error => ({ status, error }))))("keeps the token for ambiguous HTTP $status $error", async ({ status, error }) => {
    const f = fixture(response(status, { error }));
    await expect(f.request(new AbortController().signal)).rejects.toThrow("No se han podido sincronizar los pedidos");
    expect(f.end).not.toHaveBeenCalled();
    expect(f.fetcher).toHaveBeenCalledOnce();
  });

  it.each([401, 403])("ends the current local session for explicit authentication HTTP %s", async status => {
    const f = fixture(response(status, { error: "AUTHENTICATION_REQUIRED" }));
    await expect(f.request(new AbortController().signal)).rejects.toThrow("No se han podido sincronizar los pedidos");
    expect(f.end).toHaveBeenCalledExactlyOnceWith("La API requiere que inicies sesión de nuevo para recibir ofertas.");
  });

  it.each([401, 403].flatMap(status => ["epoch", "token", "rider", "abort"].map(change => ({ status, change }))))("ignores a late explicit HTTP $status auth body after $change changes", async ({ status, change }) => {
    let finish!: (value: unknown) => void;
    const body = new Promise<unknown>(resolve => { finish = resolve; });
    const json = vi.fn(() => body);
    const f = fixture({ status, ok: false, clone: () => ({ json }) } as unknown as Response);
    const controller = new AbortController();
    const work = f.request(controller.signal);
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    if (change === "epoch") f.epoch.current++;
    if (change === "token") f.token.current = "mock-B";
    if (change === "rider") f.rider.current = "fixture-rider-B";
    if (change === "abort") controller.abort();
    finish({ error: "AUTHENTICATION_REQUIRED" });
    await expect(work).rejects.toBeDefined();
    expect(f.end).not.toHaveBeenCalled();
  });

  it("accepts a successful authoritative offers snapshot", async () => {
    const f = fixture(response(200, { offers: [{ _id: "fixture", assignmentState: "offered", status: "preparing" }] }));
    await expect(f.request(new AbortController().signal)).resolves.toHaveLength(1);
    expect(f.end).not.toHaveBeenCalled();
  });
});
