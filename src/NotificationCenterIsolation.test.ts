/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { requiresRiderAuthentication } from "./apiAuthPolicy";
import { compile, findNode, jsx } from "./test/offlineComponent";

const source = readFileSync(new URL("./NotificationCenter.tsx", import.meta.url), "utf8");
const compiled = compile(source, "NotificationCenter.tsx");
const notice = (owner: string) => ({ id: "shared-id", category: "support", title: `${owner} notice`, body: owner, url: `/${owner}`, readAt: null, createdAt: "2026-11-11T00:00:00Z" });
const inbox = (owner: string) => new Response(JSON.stringify({ notifications: [notice(owner)], unreadCount: 2 }), { status: 200 });
const unauthorized = () => new Response('{"error":"AUTHENTICATION_REQUIRED"}', { status: 401 });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
type Effect = { deps: unknown[]; cleanup?: () => void };
function fixture() {
  const values: unknown[] = [], refs: { current: unknown }[] = [], effects: Effect[] = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, dirty = false;
  let pendingEffects: { slot: number; callback: () => (() => void) | void; deps: unknown[] }[] = [];
  let load!: (force?: boolean) => Promise<void>;
  const onUnauthorized = vi.fn(), onUnreadChange = vi.fn(), assign = vi.fn();
  const fetcher = vi.fn(async (_url: string, _options: unknown): Promise<Response> => inbox("A"));
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports, Date, Response, console, fetch: fetcher,
    window: { location: { assign }, setTimeout: () => 1, clearTimeout: vi.fn(), setInterval: () => 2, clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    document: { visibilityState: "visible" },
    require(name: string) {
      if (name.endsWith(".css") || name === "lucide-react") return {};
      if (name === "react/jsx-runtime") return jsx;
      if (name === "./apiAuthPolicy") return { requiresRiderAuthentication };
      if (name === "react") return {
        useState(initial: unknown) {
          const slot = stateIndex++;
          if (!(slot in values)) values[slot] = initial;
          return [values[slot], (value: unknown) => {
            const next = typeof value === "function" ? value(values[slot]) : value;
            if (!Object.is(next, values[slot])) dirty = true;
            values[slot] = next;
          }];
        },
        useRef(initial: unknown) { const slot = refIndex++; return refs[slot] ??= { current: initial }; },
        useCallback(callback: typeof load) { load = callback; return callback; },
        useEffect(callback: () => (() => void) | void, deps: unknown[]) {
          const slot = effectIndex++, old = effects[slot];
          if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) pendingEffects.push({ slot, callback, deps });
        },
      };
      throw new Error(`Unmocked dependency: ${name}`);
    },
  });
  const component = (module.exports as { default: (props: Record<string, unknown>) => ReturnType<typeof jsx.jsx> }).default;
  let props = { apiOrigin: "https://offline.invalid", token: "mock-A", surface: "rider", onUnauthorized, onUnreadChange };
  let tree: ReturnType<typeof jsx.jsx>;
  const render = (updates: Partial<typeof props> = {}) => {
    props = { ...props, ...updates };
    for (let attempt = 0; attempt < 10; attempt++) {
      stateIndex = refIndex = effectIndex = 0; pendingEffects = []; dirty = false;
      tree = component(props);
      for (const effect of pendingEffects) effects[effect.slot]?.cleanup?.();
      for (const effect of pendingEffects) effects[effect.slot] = { deps: effect.deps, cleanup: effect.callback() || undefined };
      if (!dirty) return tree;
    }
    throw new Error("Fixture failed to stabilize");
  };
  const click = (match: Parameters<typeof findNode>[1]) => {
    const node = findNode(tree, match);
    expect(node, "Required real component action must exist").toBeDefined();
    (node!.props.onClick as () => void)();
  };
  render();
  return {
    values, refs, props: () => props, render, fetcher, assign, onUnauthorized, onUnreadChange,
    load: () => load(true),
    unmount: () => { effects.forEach(effect => effect.cleanup?.()); },
    async prepare() {
      await load(true); render();
      click(node => node.props["aria-haspopup"] === "dialog");
      await settle(); render();
      expect(values[1]).toEqual([notice("A")]);
      expect(values[2]).toBe(2);
    },
    act(action: string) {
      if (action === "load") return load(true);
      click(node => action === "all" ? node.props["aria-label"] === "Marcar todas como leídas" : String(node.props.className || "").includes("piki-notification-item"));
      return undefined;
    },
    snapshot: () => JSON.stringify({ values, summaries: onUnreadChange.mock.calls, logout: onUnauthorized.mock.calls, navigation: assign.mock.calls }),
  };
}

describe("NotificationCenter generation isolation — real component, offline hooks and I/O", () => {
  for (const action of ["load", "all", "one"]) {
    for (const change of ["login-B", "logout", "unmount", "surface"]) {
      it.each(["200", "401", "network"])(`${action}: late %s after ${change} cannot change current auth/inbox/navigation`, async outcome => {
        const f = fixture(); await f.prepare();
        const request = deferred<Response>(); f.fetcher.mockImplementationOnce(() => request.promise);
        const beforeRequests = f.fetcher.mock.calls.length;
        const work = f.act(action);
        expect(f.fetcher).toHaveBeenCalledTimes(beforeRequests + 1);
        const options = f.fetcher.mock.calls.at(-1)![1] as { headers: Record<string, string> };
        expect(options.headers.Authorization).toBe("Bearer mock-A");
        if (change === "unmount") f.unmount();
        else {
          f.render(change === "logout" ? { token: "" } : change === "surface" ? { surface: "fleet" } : { token: "mock-B" });
          expect(f.values[1]).toEqual([]); expect(f.values[2]).toBe(0); expect(f.values[0]).toBe(false);
          if (change !== "logout") {
            f.fetcher.mockResolvedValueOnce(inbox("B"));
            await f.load(); f.render();
            expect(f.values[1]).toEqual([notice("B")]); expect(f.values[2]).toBe(2);
            expect(f.onUnreadChange).toHaveBeenLastCalledWith({ support: 1, customer: 0 });
          }
        }
        const snapshot = f.snapshot();
        if (outcome === "network") request.reject(new Error("A late network failure"));
        else request.resolve(outcome === "401" ? unauthorized() : inbox("A"));
        await work; await settle();
        if (change !== "unmount") f.render();
        expect(f.snapshot()).toBe(snapshot);
        expect(f.onUnauthorized).not.toHaveBeenCalled(); expect(f.assign).not.toHaveBeenCalled();
      });
    }
    it(`${action}: rechecks ownership after delayed explicit-auth JSON`, async () => {
      const f = fixture(); await f.prepare(); const body = deferred<unknown>();
      const json = vi.fn(() => body.promise);
      f.fetcher.mockResolvedValueOnce({ status: 401, ok: false, clone: () => ({ json }) } as unknown as Response);
      const work = f.act(action); await settle(); expect(json).toHaveBeenCalledOnce();
      f.render({ token: "mock-B" }); f.fetcher.mockResolvedValueOnce(inbox("B")); await f.load(); f.render();
      const snapshot = f.snapshot(); body.resolve({ error: "AUTHENTICATION_REQUIRED" });
      await work; await settle(); f.render(); expect(f.snapshot()).toBe(snapshot);
    });
  }
  it("load rechecks ownership after delayed inbox JSON and cannot release B's pending load", async () => {
    const f = fixture(); await f.prepare(); const body = deferred<unknown>(), pendingB = deferred<Response>();
    const json = vi.fn(() => body.promise);
    f.fetcher.mockResolvedValueOnce({ status: 200, ok: true, json } as unknown as Response);
    const work = f.load(); await settle(); expect(json).toHaveBeenCalledOnce();
    f.render({ token: "mock-B" }); f.fetcher.mockImplementationOnce(() => pendingB.promise);
    const workB = f.load(); const snapshot = f.snapshot();
    body.resolve({ notifications: [notice("A")], unreadCount: 99 }); await work; await settle();
    expect(f.snapshot()).toBe(snapshot); expect(f.values[3]).toBe(true);
    expect(f.refs[0].current).not.toBeNull();
    pendingB.resolve(inbox("B")); await workB; f.render();
    expect(f.values[1]).toEqual([notice("B")]); expect(f.values[2]).toBe(2); expect(f.values[3]).toBe(false);
  });
});

describe("App's actual NotificationCenter unauthorized callback", () => {
  const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "NotificationCenter") {
      for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "onUnauthorized" && attribute.initializer && ts.isJsxExpression(attribute.initializer)) expression = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!expression) throw new Error("Real NotificationCenter callback not found");
  it.each(["current", "epoch", "token"])("only logs out the current captured App session (%s)", change => {
    const epoch = { current: 1 }, token = { current: "mock-A" }, endRiderSession = vi.fn();
    const callback = runInNewContext(compile(`const callback = ${expression!.getText(ast)}; callback;`, "callback.ts"), { riderSessionEpochRef: epoch, activeTokenRef: token, apiToken: "mock-A", endRiderSession }) as () => void;
    if (change === "epoch") epoch.current++;
    if (change === "token") token.current = "mock-B";
    callback(); expect(endRiderSession).toHaveBeenCalledTimes(change === "current" ? 1 : 0);
  });
});

describe("NotificationCenter isolation positive controls", () => {
  it.each(["load", "all", "one"])("%s still reports legitimate current-session authentication failures", async action => {
    const f = fixture(); await f.prepare(); f.fetcher.mockResolvedValueOnce(unauthorized());
    await f.act(action); await settle();
    expect(f.onUnauthorized).toHaveBeenCalledOnce();
    expect(f.assign).not.toHaveBeenCalled();
  });
  it("a logout and same-token relogin invalidates the old generation", async () => {
    const f = fixture(); await f.prepare(); const request = deferred<Response>();
    f.fetcher.mockImplementationOnce(() => request.promise); const work = f.load();
    f.render({ token: "" }); f.render({ token: "mock-A" });
    f.fetcher.mockResolvedValueOnce(inbox("B")); await f.load(); f.render();
    expect(f.values[1]).toEqual([notice("B")]); const snapshot = f.snapshot();
    request.resolve(unauthorized()); await work; await settle(); f.render();
    expect(f.snapshot()).toBe(snapshot); expect(f.onUnauthorized).not.toHaveBeenCalled();
  });
});
