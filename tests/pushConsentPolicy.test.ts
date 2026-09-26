import { describe, expect, it } from "vitest";
import { shouldShowPushConsent } from "../src/pushConsentPolicy";

describe("shouldShowPushConsent", () => {
  it("hides the consent card after permission is granted", () => {
    expect(shouldShowPushConsent({ supported: true, authenticated: true, permission: "granted" })).toBe(false);
  });

  it("hides the consent card after permission is denied", () => {
    expect(shouldShowPushConsent({ supported: true, authenticated: true, permission: "denied" })).toBe(false);
  });

  it("shows it only for an authenticated supported browser with undecided permission", () => {
    expect(shouldShowPushConsent({ supported: true, authenticated: true, permission: "default" })).toBe(true);
  });

  it("hides it for unauthenticated or unsupported contexts", () => {
    expect(shouldShowPushConsent({ supported: true, authenticated: false, permission: "default" })).toBe(false);
    expect(shouldShowPushConsent({ supported: false, authenticated: true, permission: "default" })).toBe(false);
  });
});
