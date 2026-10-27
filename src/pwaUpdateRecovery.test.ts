import { describe, expect, it } from "vitest";
import {
  canReloadAfterControllerChange,
  getRequiredPwaUpdate,
  pwaReloadMarker,
  shouldDeferPwaActivation,
} from "./pwaUpdateRecovery";

const current = { version: "0.4.3", buildId: "current-build" };
const surface = "rider";

describe("PWA update recovery", () => {
  it("does not loop when the server keeps updateRequired after this version and build are current", () => {
    expect(getRequiredPwaUpdate({
      surface,
      version: "0.4.3",
      minimumVersion: "0.4.3",
      buildId: "current-build",
      forceUpdate: true,
      updateRequired: true,
    }, current, surface)).toBeNull();
  });

  it("requires a newer semantic version but ignores build-hash changes", () => {
    expect(getRequiredPwaUpdate({
      surface,
      version: "0.4.4",
      minimumVersion: "0.4.4",
      buildId: "new-version-build",
      forceUpdate: true,
    }, current, surface)).toMatchObject({ kind: "version", targetVersion: "0.4.4" });

    expect(getRequiredPwaUpdate({
      surface,
      version: "0.4.3",
      minimumVersion: "0.4.3",
      buildId: "new-web-build",
      forceUpdate: true,
    }, current, surface)).toBeNull();
  });

  it("defers an activation until Rider state is known and no delivery or form action is active", () => {
    expect(shouldDeferPwaActivation({ known: false, active: false })).toBe(true);
    expect(shouldDeferPwaActivation({ known: true, active: true })).toBe(true);
    expect(shouldDeferPwaActivation({ known: true, active: false })).toBe(false);
  });

  it("reloads only after a requested controller change and only once for its target build", () => {
    expect(canReloadAfterControllerChange({
      activationRequested: true,
      safety: { known: true, active: false },
      alreadyReloadedForTarget: false,
    })).toBe(true);
    expect(canReloadAfterControllerChange({
      activationRequested: true,
      safety: { known: true, active: true },
      alreadyReloadedForTarget: false,
    })).toBe(false);
    expect(canReloadAfterControllerChange({
      activationRequested: true,
      safety: { known: true, active: false },
      alreadyReloadedForTarget: true,
    })).toBe(false);
    expect(pwaReloadMarker("new-web-build")).toBe("piki-rider-pwa-reload:new-web-build");
  });
});
