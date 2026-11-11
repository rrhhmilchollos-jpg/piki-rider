import { describe, expect, it, vi } from "vitest";
import { refreshRiderDataPanels, riderDataRequestTimeoutMs } from "./riderDataRefresh";
import { parseRiderShiftSnapshot, riderSnapshotHasActiveShift } from "./riderShiftSync";

const closedShift = { eligible: false, shift: { date: "2026-11-11", startTime: "12:00", endTime: "00:00", status: "completed" } };
const quietPanel = async () => {};

describe("Independent Rider data refresh", () => {
  it("applies an official closure even when the slots JSON is invalid", async () => {
    let active = true;
    const stopGps = vi.fn();
    const results = await refreshRiderDataPanels({
      shift: async () => {
        const snapshot = parseRiderShiftSnapshot(await new Response(JSON.stringify(closedShift)).json())!;
        active = riderSnapshotHasActiveShift(snapshot);
        if (!active) stopGps();
      },
      slots: async () => { await new Response("invalid JSON").json(); },
      statistics: quietPanel,
      cashWallet: quietPanel,
    });
    expect(active).toBe(false);
    expect(stopGps).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("does not wait for a slow cash wallet before applying the shift response", async () => {
    let finishWallet!: () => void;
    const wallet = new Promise<void>((resolve) => { finishWallet = resolve; });
    const appliedShift = vi.fn();
    const refresh = refreshRiderDataPanels({
      shift: async () => { appliedShift(); },
      slots: quietPanel,
      statistics: quietPanel,
      cashWallet: () => wallet,
    });
    await Promise.resolve();
    expect(appliedShift).toHaveBeenCalledTimes(1);
    finishWallet();
    await refresh;
  });

  it("isolates network failures and keeps a bounded timeout for all data requests", async () => {
    const appliedShift = vi.fn();
    await refreshRiderDataPanels({
      shift: async () => { appliedShift(); },
      slots: async () => { throw new TypeError("network unavailable"); },
      statistics: quietPanel,
      cashWallet: quietPanel,
    });
    expect(appliedShift).toHaveBeenCalledTimes(1);
    expect(riderDataRequestTimeoutMs).toBe(15_000);
  });
});
