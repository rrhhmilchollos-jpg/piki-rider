import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Shift } from "./types/rider";
const device = vi.hoisted(() => ({
  android: true, checkPermissions: vi.fn(async () => ({ display: "granted" })),
  getPending: vi.fn(async () => ({ notifications: [] as { id: number }[] })),
  cancel: vi.fn(async (_input: unknown) => {}), schedule: vi.fn(async (_input: unknown) => ({})),
  requestPermissions: vi.fn(), prepareChannels: vi.fn(async () => ({ shift: true, order: true, cancelled: true })),
  checkExactNotificationSetting: vi.fn(async () => ({ exact_alarm: "denied" })),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => device.android, getPlatform: () => device.android ? "android" : "web" }, registerPlugin: () => device }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: device }));
import { clearShiftStartAlarms, syncShiftStartAlarms, madridInstant } from "./shiftStartAlarms";
const shift: Shift = { date: "2026-11-12", day: "Jueves", start: "08:00", end: "12:00", zone: "zona-real", status: "assigned" };
let storage: Map<string, string>;
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
  storage = new Map();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  device.android = true;
  device.getPending.mockResolvedValue({ notifications: [] });
  device.checkPermissions.mockResolvedValue({ display: "granted" });
  device.prepareChannels.mockResolvedValue({ shift: true, order: true, cancelled: true });
  await clearShiftStartAlarms(); vi.clearAllMocks();
});
afterEach(async () => { await clearShiftStartAlarms(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("native calendar synchronization", () => {
  it("programs the real sound with an explicit channel and no permission request", async () => {
    expect(await syncShiftStartAlarms([shift], { enabled: true })).toBe(1);
    expect(device.schedule).toHaveBeenCalledWith({ notifications: [expect.objectContaining({ channelId: "piki_shift_start", sound: "start_shift.wav" })] });
    expect(device.requestPermissions).not.toHaveBeenCalled();
    expect(device.checkExactNotificationSetting).toHaveBeenCalled();
  });
  it("cancels reminders after Fleet returns an empty calendar", async () => {
    await syncShiftStartAlarms([shift], { enabled: true });
    expect(await syncShiftStartAlarms([], { enabled: true })).toBe(0);
    expect(device.cancel).toHaveBeenCalledWith({ notifications: [expect.objectContaining({ id: expect.any(Number) })] });
    expect([...storage.values()]).toContain("[]");
  });
  it("revoked consent cancels previously remembered native alarms", async () => {
    await syncShiftStartAlarms([shift], { enabled: true });
    expect(await syncShiftStartAlarms([shift])).toBe(0);
    expect(device.cancel).toHaveBeenCalled();
    expect(device.schedule).toHaveBeenCalledTimes(1);
  });
  it("revoked OS permission still cancels old alarms without reprompt", async () => {
    await syncShiftStartAlarms([shift], { enabled: true });
    device.checkPermissions.mockResolvedValue({ display: "denied" });
    expect(await syncShiftStartAlarms([shift], { enabled: true })).toBe(0);
    expect(device.cancel).toHaveBeenCalled(); expect(device.requestPermissions).not.toHaveBeenCalled();
  });
  it("recovers native pending IDs even without local storage, without cancelling another category", async () => {
    device.getPending.mockResolvedValue({ notifications: [{ id: 740123 }, { id: 830123 }] });
    await clearShiftStartAlarms();
    expect(device.cancel).toHaveBeenCalledWith({ notifications: [{ id: 740123 }] });
  });
  it("keeps cancellable IDs after native scheduling fails", async () => {
    device.schedule.mockRejectedValueOnce(new Error("partial native failure"));
    expect(await syncShiftStartAlarms([shift], { enabled: true })).toBe(0);
    await clearShiftStartAlarms(); expect(device.cancel).toHaveBeenCalled();
  });
  it("does not churn identical five-second polling calendars", async () => {
    await syncShiftStartAlarms([shift], { enabled: true });
    await syncShiftStartAlarms([shift], { enabled: true });
    expect(device.schedule).toHaveBeenCalledTimes(1);
  });
  it("logout invalidates a concurrently queued calendar sync", async () => {
    const old = syncShiftStartAlarms([shift], { enabled: true });
    await clearShiftStartAlarms(); await old;
    expect(device.schedule).not.toHaveBeenCalled();
  });
  it.each(["active", "completed", "cancelled"] as const)("does not replay a %s shift", async (status) => {
    expect(await syncShiftStartAlarms([{ ...shift, status }], { enabled: true })).toBe(0);
  });
  it("does not create an immutable channel before the real resource arrives", async () => {
    device.prepareChannels.mockResolvedValue({ shift: false, order: false, cancelled: false });
    expect(await syncShiftStartAlarms([shift], { enabled: true })).toBe(0);
    expect(device.schedule).not.toHaveBeenCalled();
  });
  it("rejects impossible dates and both problematic DST hours", () => {
    expect(madridInstant("2026-02-30", "08:00")).toBeNull();
    expect(madridInstant("2026-03-29", "02:30")).toBeNull();
    expect(madridInstant("2026-10-25", "02:30")).toBeNull();
    expect(madridInstant("2026-03-29", "01:30")?.toISOString()).toBe("2026-03-29T00:30:00.000Z");
  });
});
