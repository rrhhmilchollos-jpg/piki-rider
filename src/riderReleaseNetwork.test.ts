import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRiderReleasePolicy } from "./riderReleaseNetwork";
import { fetchPikiStaticRelease } from "./pikiPwaUpdate";

const current = { surface: "rider", version: "1.0.17", buildId: "current" };
const policy = { ...current, minimumVersion: "0.0.0", forceUpdate: false, updateRequired: false };
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
afterEach(() => vi.useRealTimers());

describe("comprobación de versión Rider", () => {
  it("consulta únicamente la API configurada y conserva la identidad de la app", async () => {
    const fetcher = vi.fn(async () => jsonResponse(policy));
    expect(await fetchRiderReleasePolicy(fetcher as typeof fetch, "https://api.mock.invalid", current)).toEqual(policy);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.mock.invalid/api/v1/app-version?");
    expect(url).toContain("surface=rider");
    expect(url).toContain("clientVersion=1.0.17");
    expect(options.cache).toBe("no-store");
    expect(options.signal).toBeDefined();
  });

  it("recupera una interrupción transitoria sin aceptar una respuesta incompleta", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(jsonResponse(policy));
    expect(await fetchRiderReleasePolicy(fetcher as typeof fetch, "https://api.mock.invalid", current, 100, [0, 0])).toEqual(policy);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([{ ...policy, surface: "partner" }, {}, null, { ...policy, forceUpdate: "true" }])("rechaza política inválida %j", async (body) => {
    const fetcher = vi.fn(async () => jsonResponse(body));
    await expect(fetchRiderReleasePolicy(fetcher as typeof fetch, "https://api.mock.invalid", current, 100, [0])).rejects.toThrow("VERSION_POLICY_INVALID");
  });

  it("termina aunque el transporte ignore AbortSignal", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const assertion = expect(fetchRiderReleasePolicy(fetcher as typeof fetch, "https://api.mock.invalid", current, 100, [0])).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
  });

  it("limita también un cuerpo JSON que queda bloqueado", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }));
    const assertion = expect(fetchRiderReleasePolicy(fetcher as unknown as typeof fetch, "https://api.mock.invalid", current, 100, [0])).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
  });

  it("un fallo persistente solo consume el número configurado de intentos", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchRiderReleasePolicy(fetcher as typeof fetch, "https://api.mock.invalid", current, 100, [0, 0, 0])).rejects.toThrow("Failed to fetch");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("fallback estático de la PWA", () => {
  it("obtiene el release desde Vercel, no desde una API de otra superficie", async () => {
    const fetcher = vi.fn(async () => jsonResponse(current));
    expect(await fetchPikiStaticRelease(fetcher as typeof fetch, "https://rider.mock.invalid", "rider", "probe")).toEqual(current);
    const [url] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rider.mock.invalid/release.json?piki_release=probe");
  });

  it("limita el fallback estático si Vercel no responde", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const assertion = expect(fetchPikiStaticRelease(fetcher as typeof fetch, "https://rider.mock.invalid", "rider", "probe", 100)).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
  });
});
