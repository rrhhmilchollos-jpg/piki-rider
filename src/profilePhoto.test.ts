import { afterEach, describe, expect, it, vi } from "vitest";
import { patchOwnProfilePhoto, prepareProfilePhoto, profilePhotoDimensions, validateProfilePhoto, PROFILE_PHOTO_ACCEPT, PROFILE_PHOTO_MAX_CHARS } from "./profilePhoto";

const jpeg = "data:image/jpeg;base64,YWJj";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("own raster profile photo", () => {
  it.each([[4000, 2000, 256, 128], [2000, 4000, 128, 256], [32, 64, 32, 64], [1, 10000, 1, 256]])("preserves aspect ratio and maximum 256px for %sx%s", (w, h, width, height) => {
    expect(profilePhotoDimensions(w, h)).toEqual({ width, height });
  });
  it.each([[0, 20], [20, 0], [-1, 20], [NaN, 20], [Infinity, 20]])("rejects invalid dimensions %s x %s", (w, h) => {
    expect(() => profilePhotoDimensions(w, h)).toThrow();
  });
  it("accepts only JPEG, PNG, WebP and caps the entire data URL", () => {
    expect(PROFILE_PHOTO_ACCEPT).toBe("image/jpeg,image/png,image/webp");
    expect(PROFILE_PHOTO_MAX_CHARS).toBe(220_000);
    const prefix = "data:image/jpeg;base64,";
    expect(() => validateProfilePhoto(prefix + "A".repeat(220_000 - prefix.length))).not.toThrow();
    expect(() => validateProfilePhoto(prefix + "A".repeat(220_001 - prefix.length))).toThrow("tamaño");
    expect(() => validateProfilePhoto("data:image/svg+xml;base64,YWJj")).toThrow("válida");
    expect(() => validateProfilePhoto("https://storage.invalid/photo.jpeg")).toThrow("válida");
    expect(() => validateProfilePhoto(null)).not.toThrow();
  });
  it.each(["image/jpeg", "image/png", "image/webp"])("re-encodes %s locally with max 256px and JPEG .8, without getUserMedia", async (type) => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:own-file");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), toDataURL: vi.fn(() => jpeg) };
    const createElement = vi.fn(() => canvas);
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("Image", class {
      naturalWidth = 4000;
      naturalHeight = 2000;
      onload = () => undefined;
      set src(_value: string) { this.onload(); }
    });
    const file = new File(["test-raster"], "own-photo", { type });
    expect(await prepareProfilePhoto(file)).toBe(jpeg);
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(createElement).toHaveBeenCalledWith("canvas");
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(128);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.8);
    expect(context.drawImage).toHaveBeenCalledWith(expect.any(Object), 0, 0, 256, 128);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:own-file");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it.each(["image/svg+xml", "image/gif", "application/pdf", ""])("rejects original unsupported MIME %s before decoding/upload", async (type) => {
    const file = new File(["invalid"], "not-photo", { type });
    await expect(prepareProfilePhoto(file)).rejects.toThrow("válida");
  });
  it("revokes local URL on corrupt raster decode", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:corrupt");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("Image", class { onerror = () => undefined; set src(_value: string) { this.onerror(); } });
    await expect(prepareProfilePhoto(new File(["bad"], "bad.png", { type: "image/png" }))).rejects.toThrow("leer la foto");
    expect(revoke).toHaveBeenCalledWith("blob:corrupt");
  });
  it.each([jpeg, null])("sends exactly one Bearer PATCH with only photoUrl %s", async (photoUrl) => {
    const ack = new Response(JSON.stringify({ employee: { photoUrl } }), { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(ack);
    vi.stubGlobal("fetch", fetchMock);
    expect(await patchOwnProfilePhoto("https://api.invalid", "mock-token", photoUrl)).toBe(ack);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.invalid/api/v1/auth/employee/profile");
    expect(request.method).toBe("PATCH");
    expect(request.headers).toEqual({ Authorization: "Bearer mock-token", "Content-Type": "application/json" });
    expect(JSON.parse(request.body as string)).toEqual({ photoUrl });
    expect(request.cache).toBe("no-store");
  });
  it("does not send request with invalid photo or empty credential", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(patchOwnProfilePhoto("https://api.invalid", "mock", "data:image/svg+xml;base64,YWJj")).rejects.toThrow();
    await expect(patchOwnProfilePhoto("https://api.invalid", "", jpeg)).rejects.toThrow("sesión");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
