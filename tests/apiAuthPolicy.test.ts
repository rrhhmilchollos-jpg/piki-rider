import { describe, expect, it } from "vitest";
import { requiresRiderAuthentication } from "../src/apiAuthPolicy";

describe("rider API authentication policy", () => {
  it("requires login for an unauthorized response", async () => {
    expect(await requiresRiderAuthentication(new Response(null, { status: 401 }))).toBe(true);
  });

  it("does not erase a session for a permission denial", async () => {
    const response = Response.json({ error: "FORBIDDEN" }, { status: 403 });
    expect(await requiresRiderAuthentication(response)).toBe(false);
  });

  it("keeps the session on an app-version precondition", async () => {
    const response = Response.json({ error: "UPDATE_REQUIRED" }, { status: 428 });
    expect(await requiresRiderAuthentication(response)).toBe(false);
  });

  it("recognizes explicit authentication errors from other status codes", async () => {
    const response = Response.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 403 });
    expect(await requiresRiderAuthentication(response)).toBe(true);
  });
});
