/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { compile } from "./test/offlineComponent";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.ArrowFunction | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const candidate = node.arguments[0];
    if (candidate && ts.isArrowFunction(candidate) && candidate.getText(ast).includes("onNotificationIntent")) effect = candidate;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!effect) throw new Error("Actual notification intent effect not found");

function fixture(message = "", supported = true) {
  let toast = message;
  const setToast = vi.fn((updater: (current: string) => string) => { toast = updater(toast); });
  const worker = new EventTarget();
  const cleanup = runInNewContext(compile(`(${effect!.getText(ast)})();`, "notification-effect.ts"), {
    navigator: supported ? { serviceWorker: worker } : {}, setToast,
    // Any accidental navigation, token write or network call must fail this test.
    window: { location: { reload: () => { throw new Error("reload forbidden"); }, replace: () => { throw new Error("navigation forbidden"); } } },
    sessionStorage: { removeItem: () => { throw new Error("token deletion forbidden"); } },
    localStorage: { setItem: () => { throw new Error("storage write forbidden"); } },
    fetch: () => { throw new Error("network mutation forbidden"); },
  }) as (() => void) | undefined;
  const send = (type = "PIKI_NOTIFICATION_INTENT") => worker.dispatchEvent(new MessageEvent("message", { data: { type, path: "/auth/logout" } }));
  return { setToast, send, cleanup, toast: () => toast };
}

describe("SPA notification intent — extracted real effect, no browser", () => {
  it("shows a generic informational message without following the untrusted route", () => {
    const f = fixture(); f.send();
    expect(f.toast()).toContain("tu jornada y la pantalla actual se conservan");
    expect(f.setToast).toHaveBeenCalledOnce();
    f.cleanup!();
  });
  it.each(["Confirmando retiro…", "Entrega pendiente de verificar", "Turno activo", "Error de conexión"])("preserves the existing operational message: %s", message => {
    const f = fixture(message); f.send(); expect(f.toast()).toBe(message); f.cleanup!();
  });
  it("ignores unrelated SW messages and removes its handler on disposal", () => {
    const f = fixture(); f.send("PIKI_SW_ACTIVATED"); expect(f.setToast).not.toHaveBeenCalled();
    f.cleanup!(); f.send(); expect(f.setToast).not.toHaveBeenCalled();
  });
  it("does not require a worker in native/unsupported environments", () => {
    const f = fixture("", false); expect(f.cleanup).toBeUndefined(); expect(f.setToast).not.toHaveBeenCalled();
  });
});
