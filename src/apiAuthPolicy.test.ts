import { describe, expect, it } from "vitest";
import { isRiderAuthenticationErrorMessage, requiresRiderAuthentication } from "./apiAuthPolicy";

function apiResponse(status: number, body: unknown, contentType = "application/json") {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

describe("Rider authentication response policy", () => {
  it("clears a token only for an explicit API authentication code", async () => {
    expect(await requiresRiderAuthentication(apiResponse(401, { error: "AUTHENTICATION_REQUIRED" }))).toBe(true);
    expect(await requiresRiderAuthentication(apiResponse(401, { code: "TOKEN_EXPIRED" }))).toBe(true);
    expect(await requiresRiderAuthentication(apiResponse(428, { error: "PASSWORD_CHANGE_REQUIRED" }))).toBe(true);
  });

  it("preserves the token on generic proxy 401 and non-auth authorization errors", async () => {
    expect(await requiresRiderAuthentication(apiResponse(401, "<html>Unauthorized</html>", "text/html"))).toBe(false);
    expect(await requiresRiderAuthentication(apiResponse(401, { error: "UPSTREAM_UNAVAILABLE" }))).toBe(false);
    expect(await requiresRiderAuthentication(apiResponse(403, { error: "RIDER_ACCESS_DENIED" }))).toBe(false);
    expect(await requiresRiderAuthentication(apiResponse(500, { error: "AUTHENTICATION_REQUIRED" }))).toBe(false);
  });

  it("parses explicit auth codes from the API client's error message but not generic 401 text", () => {
    expect(isRiderAuthenticationErrorMessage('API 401: {"error":"AUTHENTICATION_REQUIRED"}')).toBe(true);
    expect(isRiderAuthenticationErrorMessage('API 401: Unauthorized')).toBe(false);
    expect(isRiderAuthenticationErrorMessage('API 403: {"error":"RIDER_ACCESS_DENIED"}')).toBe(false);
  });
});
