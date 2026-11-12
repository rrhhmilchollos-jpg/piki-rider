/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { requiresRiderAuthentication } from "./apiAuthPolicy";
import { findNode, jsx, loadComponent } from "./test/offlineComponent";

const item = { id: "fixture", category: "support", title: "Aviso guardado", body: "Fixture", url: "/support", readAt: null, createdAt: "2026-11-11T00:00:00Z" };
const cases = [
  { name: "HTML 401 proxy", status: 401, body: "<html>Unauthorized</html>", logout: false },
  { name: "generic JSON 401", status: 401, body: '{"error":"UPSTREAM_ERROR"}', logout: false },
  { name: "malformed JSON 401", status: 401, body: "{bad", logout: false },
  { name: "temporary 503", status: 503, body: "unavailable", logout: false },
  { name: "network exception", status: 0, body: "", logout: false },
  { name: "explicit 401", status: 401, body: '{"error":"AUTHENTICATION_REQUIRED"}', logout: true },
  { name: "explicit 403", status: 403, body: '{"code":"TOKEN_EXPIRED"}', logout: true },
  { name: "password change 428", status: 428, body: '{"error":"PASSWORD_CHANGE_REQUIRED"}', logout: true },
];
describe("NotificationCenter callbacks — offline React/platform mocks", () => {
  for (const action of ["load", "all", "one"]) {
    it.each(cases)(`${action}: $name`, async ({ status, body, logout }) => {
      const values: unknown[] = [true, [item], 1, false, ""];
      let index = 0;
      const loadCallbacks: ((force?: boolean) => Promise<void>)[] = [];
      const onUnauthorized = vi.fn();
      const assign = vi.fn();
      const fetcher = vi.fn(async () => {
        if (!status) throw new Error("Fixture offline");
        return new Response(body, { status });
      });
      const component = loadComponent("src/NotificationCenter.tsx", {
        react: {
          useState: () => {
            const slot = index++;
            return [values[slot], (value: unknown) => {
              values[slot] = typeof value === "function" ? value(values[slot]) : value;
            }];
          },
          useRef: (value: unknown) => ({ current: value }), useEffect: () => {},
          useCallback: (callback: (force?: boolean) => Promise<void>) => { loadCallbacks.push(callback); return callback; },
        },
        "react/jsx-runtime": jsx, "lucide-react": {}, "./apiAuthPolicy": { requiresRiderAuthentication },
      }, { fetch: fetcher, window: { location: { assign } } });
      const tree = component.default({ apiOrigin: "https://mock.invalid", token: "mock-only", surface: "rider", onUnauthorized });
      if (action === "load") await loadCallbacks[0](true);
      else {
        const node = findNode(tree, (candidate) => action === "all"
          ? candidate.props["aria-label"] === "Marcar todas como leídas"
          : String(candidate.props.className || "").includes("piki-notification-item"));
        expect(node).toBeDefined();
        (node!.props.onClick as () => void)();
        await vi.waitFor(() => {
          if (logout) expect(onUnauthorized).toHaveBeenCalledTimes(1);
          else expect(values[4]).not.toBe("");
        });
      }
      expect(onUnauthorized).toHaveBeenCalledTimes(logout ? 1 : 0);
      expect(values[1]).toEqual([item]);
      expect(values[2]).toBe(1);
      if (!logout) expect(values[4]).not.toBe("");
      if (action === "one") expect(assign).toHaveBeenCalledTimes(logout ? 0 : 1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  }
});
