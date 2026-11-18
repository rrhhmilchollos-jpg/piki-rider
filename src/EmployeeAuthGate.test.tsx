import { afterEach, describe, expect, it, vi } from "vitest";
import { findNode, jsx, loadComponent, type Tree } from "./test/offlineComponent";

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(request: () => Promise<Response>, search = "") {
  const state: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const effects: { deps: unknown[]; cleanup: (() => void) | void }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  const fetchMock = vi.fn((_url: string, _init: { body: string; headers: Record<string, string> }) => request());
  const authenticated = vi.fn();
  const busy = vi.fn();
  const storeEmail = vi.fn();
  const forgetEmail = vi.fn();
  const replaceState = vi.fn();
  const component = loadComponent("src/EmployeeAuthGate.tsx", {
    react: {
      useState(initial: unknown) {
        const slot = stateIndex++;
        if (!(slot in state)) state[slot] = typeof initial === "function" ? initial() : initial;
        return [state[slot], (value: unknown) => {
          state[slot] = typeof value === "function" ? value(state[slot]) : value;
        }];
      },
      useRef(initial: unknown) {
        const slot = refIndex++;
        return refs[slot] ||= { current: initial };
      },
      useEffect(effect: () => (() => void) | void, deps: unknown[]) {
        const slot = effectIndex++;
        const previous = effects[slot];
        if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
          previous?.cleanup?.();
          effects[slot] = { deps, cleanup: effect() };
        }
      },
    },
    "react/jsx-runtime": jsx,
    "lucide-react": Object.fromEntries(["Eye", "EyeOff", "KeyRound", "LockKeyhole", "Mail", "Navigation", "ShieldCheck"].map((name) => [name, name])),
    "./authStorage": { getStoredEmail: () => "", storeEmail, forgetEmail },
    "./employeeLogin": { buildRiderEmployeeLoginPayload: (identifier: string, password: string) => ({ identifier, password }) },
  }, {
    Error, DOMException, fetch: fetchMock,
    window: { location: { search, pathname: "/" }, history: { replaceState }, setTimeout, clearTimeout },
  }).default;
  function render(onBusyChange = busy) {
    stateIndex = 0; refIndex = 0; effectIndex = 0;
    return component({ apiOrigin: "https://auth.invalid", onAuthenticated: authenticated, onBusyChange });
  }
  function node(match: (node: Tree) => boolean) {
    const found = findNode(render(), match);
    if (!found) throw new Error("Missing fixture node");
    return found;
  }
  function input(name: string, value: string) {
    const change = node((item) => item.tag === "input" && item.props.name === name).props.onChange as (event: unknown) => void;
    change({ target: { value } });
  }
  function remember() {
    const change = node((item) => item.tag === "input" && item.props.type === "checkbox").props.onChange as (event: unknown) => void;
    change({ target: { checked: true } });
  }
  function click(text: string) {
    (node((item) => item.tag === "button" && item.props.children === text).props.onClick as () => void)();
  }
  function submit() {
    return (node((item) => item.tag === "form").props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() });
  }
  render();
  return { render, input, remember, click, submit, fetchMock, authenticated, busy, storeEmail, forgetEmail, replaceState,
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
    alert: () => findNode(render(), (item) => item.props.role === "alert")?.props.children,
    title: () => findNode(render(), (item) => item.tag === "h2")?.props.children,
  };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("EmployeeAuthGate login contract — offline component harness", () => {
  it.each([
    ["empty object", {}], ["null body", null], ["array body", []],
    ["missing token", { requiresPasswordChange: false }],
    ["empty token", { accessToken: "" }], ["whitespace token", { accessToken: " \n " }],
    ["numeric token", { accessToken: 7 }], ["object token", { accessToken: {} }],
    ["null token", { accessToken: null }],
    ...["false", "true", 0, 1, null, {}, []].map((value): [string, unknown] => [`malformed password flag ${JSON.stringify(value)}`, { accessToken: "mock-token", requiresPasswordChange: value }]),
  ])("rejects HTTP 200 with %s before remembering identity or authenticating", async (_label, body) => {
    const f = fixture(async () => response(body));
    f.input("username", " Mock@Example.invalid "); f.remember();
    await f.submit();
    expect(f.authenticated).not.toHaveBeenCalled();
    expect(f.storeEmail).not.toHaveBeenCalled();
    expect(f.forgetEmail).not.toHaveBeenCalled();
    expect(f.title()).toBe("Entra en jornada");
    expect(f.alert()).toContain("no confirmó un acceso válido");
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
    f.unmount();
  });
  it("rejects HTML HTTP 200 without treating it as a session", async () => {
    const f = fixture(async () => new Response("<html>proxy login</html>"));
    await f.submit();
    expect(f.authenticated).not.toHaveBeenCalled();
    expect(f.forgetEmail).not.toHaveBeenCalled();
    expect(f.alert()).toContain("no confirmó un acceso válido");
    f.unmount();
  });
  it.each([{}, { requiresPasswordChange: false }])("accepts a valid nonempty token with absent/false flag (%j)", async (flag) => {
    const f = fixture(async () => response({ accessToken: " mock-token ", ...flag }));
    f.input("username", " Mock@Example.invalid "); f.remember();
    await f.submit();
    expect(f.authenticated).toHaveBeenCalledExactlyOnceWith("mock-token");
    expect(f.storeEmail).toHaveBeenCalledExactlyOnceWith("mock@example.invalid");
    expect(f.busy.mock.invocationCallOrder[0]).toBeLessThan(f.fetchMock.mock.invocationCallOrder[0]);
    expect(f.busy).toHaveBeenLastCalledWith(false);
    f.unmount();
  });
  it("requires a real boolean true before entering password change, then uses the validated token", async () => {
    const f = fixture(async () => response({ accessToken: "mock-token", requiresPasswordChange: true }));
    f.input("password", "MockTemporary12");
    await f.submit();
    expect(f.authenticated).not.toHaveBeenCalled();
    expect(f.title()).toBe("Asegura tu cuenta");
    f.input("new-password", "MockPassword12");
    await f.submit();
    expect(f.fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer mock-token");
    expect(f.authenticated).toHaveBeenCalledExactlyOnceWith("mock-token");
    expect(f.busy.mock.calls).toEqual([[true], [false], [true], [false]]);
    f.unmount();
  });
});

describe("EmployeeAuthGate busy lifecycle and recovery — offline", () => {
  it("reports true synchronously, ignores double-submit and releases on success", async () => {
    const sent = deferred<Response>();
    const f = fixture(() => sent.promise);
    const pending = f.submit();
    expect(f.busy.mock.calls).toEqual([[true]]);
    await f.submit();
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    expect(findNode(f.render(), (item) => item.props.className === "rider-access-submit")?.props.disabled).toBe(true);
    sent.resolve(response({ accessToken: "mock-token" })); await pending;
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
    f.unmount();
  });
  it("does not release busy on callback rerender and cleans up through the latest callback", async () => {
    const sent = deferred<Response>();
    const f = fixture(() => sent.promise);
    const pending = f.submit();
    const latestBusy = vi.fn();
    f.render(latestBusy);
    expect(f.busy.mock.calls).toEqual([[true]]);
    expect(latestBusy).not.toHaveBeenCalled();
    f.unmount();
    expect(latestBusy).toHaveBeenCalledExactlyOnceWith(false);
    sent.resolve(response({ accessToken: "mock-token" })); await pending;
    expect(f.authenticated).not.toHaveBeenCalled();
    expect(latestBusy).toHaveBeenCalledTimes(1);
  });
  it("reports busy around password reset and returns to login without authenticating", async () => {
    const f = fixture(async () => response({ message: "Contraseña actualizada" }), "?reset=mock-only-reset");
    f.input("new-password", "MockPassword12");
    await f.submit();
    expect(f.fetchMock.mock.calls[0][0]).toContain("/password-reset/confirm");
    expect(JSON.parse(f.fetchMock.mock.calls[0][1].body)).toEqual({ token: "mock-only-reset", newPassword: "MockPassword12" });
    expect(f.title()).toBe("Entra en jornada");
    expect(f.replaceState).toHaveBeenCalledExactlyOnceWith({}, "", "/");
    expect(f.authenticated).not.toHaveBeenCalled();
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
    f.unmount();
  });
  it.each(["response", "body"])("releases on unmount and ignores a late login %s", async (part) => {
    const body = deferred<unknown>();
    const sent = deferred<Response>();
    const f = fixture(() => part === "response" ? sent.promise : Promise.resolve({ ok: true, status: 200, json: () => body.promise } as Response));
    const pending = f.submit();
    await Promise.resolve(); await Promise.resolve();
    f.unmount();
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
    sent.resolve(response({ accessToken: "mock-token" }));
    body.resolve({ accessToken: "mock-token" });
    await pending;
    expect(f.authenticated).not.toHaveBeenCalled();
    expect(f.storeEmail).not.toHaveBeenCalled();
    expect(f.forgetEmail).not.toHaveBeenCalled();
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
  });
  it("normalizes recovery email in the actual Rider request", async () => {
    const f = fixture(async () => response({ message: "Enlace solicitado" }, 202));
    f.click("He olvidado mi contraseña");
    f.input("username", " Mixed.Case@Example.invalid ");
    await f.submit();
    const [url, request] = f.fetchMock.mock.calls[0];
    expect(url).toContain("/auth/employee/password-reset/request");
    expect(request.headers["X-PIKI-Surface"]).toBe("rider");
    expect(JSON.parse(request.body)).toEqual({ email: "mixed.case@example.invalid" });
    expect(f.authenticated).not.toHaveBeenCalled();
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
    f.unmount();
  });
  it.each([
    [{}, { error: "RATE_LIMITED", retryAfterSeconds: 37 }, "37 segundos"],
    [{ "Retry-After": "12" }, { error: "RATE_LIMITED", retryAfterSeconds: 37 }, "12 segundos"],
    [{ "Retry-After": "Wed, 18 Nov 2026 23:00:20 GMT" }, { error: "RATE_LIMITED" }, "20 segundos"],
    [{}, { error: "RATE_LIMITED", retryAfterSeconds: "private-invalid" }, "Espera un momento"],
  ])("shows the actual 429 delay without automatically retrying (%j)", async (headers, body, expected) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-18T23:00:00Z"));
    const f = fixture(async () => response(body, 429, headers));
    await f.submit();
    expect(f.alert()).toContain(expected);
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
    expect(vi.getTimerCount()).toBe(0);
    f.unmount();
  });
  it("always releases busy on failure after the existing bounded retries", async () => {
    vi.useFakeTimers();
    const f = fixture(async () => { throw new Error("Failed to fetch"); });
    const pending = f.submit();
    await vi.advanceTimersByTimeAsync(3_000); await pending;
    expect(f.busy.mock.calls).toEqual([[true], [false]]);
    expect(f.authenticated).not.toHaveBeenCalled();
    expect(f.alert()).toContain("No hay conexión");
    expect(vi.getTimerCount()).toBe(0);
    f.unmount();
  });
});
