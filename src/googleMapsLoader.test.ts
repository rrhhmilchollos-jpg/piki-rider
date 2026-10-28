import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function makeScript() {
  return {
    dataset: {} as DOMStringMap,
    onload: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    addEventListener: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLScriptElement & {
    onload: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
  };
}

function installBrowserMock(scripts: HTMLScriptElement[], previousAuthFailure = vi.fn()) {
  const windowMock = {
    google: undefined as { maps: typeof google.maps } | undefined,
    gm_authFailure: previousAuthFailure as (() => void) | undefined,
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as Window & {
    gm_authFailure?: () => void;
    google?: { maps: typeof google.maps };
  };
  const documentMock = {
    querySelector: vi.fn(() => null),
    createElement: vi.fn(() => scripts.shift()!),
    head: { appendChild: vi.fn() },
  } as unknown as Document;
  vi.stubGlobal("window", windowMock);
  vi.stubGlobal("document", documentMock);
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
  return { window: windowMock, document: documentMock, previousAuthFailure };
}

describe("loadGoogleMaps", () => {
  it("keeps the auth-failure hook after script onload", async () => {
    const script = makeScript();
    const browser = installBrowserMock([script]);
    const maps = {} as typeof google.maps;
    const { loadGoogleMaps } = await import("./integrations/google-maps");

    const result = loadGoogleMaps();
    browser.window.google = { maps };
    script.onload?.(new Event("load"));
    await expect(result).resolves.toBe(maps);

    browser.window.gm_authFailure?.();
    expect(browser.window.dispatchEvent).toHaveBeenCalledWith(expect.any(Event));
    expect(browser.previousAuthFailure).toHaveBeenCalledOnce();
    await expect(loadGoogleMaps()).rejects.toThrow("GOOGLE_MAPS_AUTH_FAILURE");
  });

  it("removes a failed script so a later request can create a fresh one", async () => {
    const firstScript = makeScript();
    const retryScript = makeScript();
    const browser = installBrowserMock([firstScript, retryScript]);
    const maps = {} as typeof google.maps;
    const { loadGoogleMaps } = await import("./integrations/google-maps");

    const firstAttempt = loadGoogleMaps();
    firstScript.onerror?.(new Event("error"));
    await expect(firstAttempt).rejects.toThrow("No se pudo cargar Google Maps");
    expect(firstScript.remove).toHaveBeenCalledOnce();

    const retryAttempt = loadGoogleMaps();
    browser.window.google = { maps };
    retryScript.onload?.(new Event("load"));
    await expect(retryAttempt).resolves.toBe(maps);
    expect(browser.document.createElement).toHaveBeenCalledTimes(2);
  });
});
