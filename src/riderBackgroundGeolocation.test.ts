import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerPlugin: vi.fn((name: string) => ({ name })),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
  CapacitorHttp: { post: vi.fn() },
  registerPlugin: mocks.registerPlugin,
}));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: { checkPermissions: vi.fn(), requestPermissions: vi.fn() },
}));

describe("shared BackgroundGeolocation registration", () => {
  it("registers one JS proxy when both Rider GPS modules load", async () => {
    vi.resetModules();
    mocks.registerPlugin.mockClear();

    await import("./riderGpsNative");
    await import("./riderGpsCapture");

    const backgroundRegistrations = mocks.registerPlugin.mock.calls
      .filter(([name]) => name === "BackgroundGeolocation");
    expect(backgroundRegistrations).toHaveLength(1);
  });
});
