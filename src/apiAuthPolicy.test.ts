import { describe, expect, it } from "vitest";
import { isRiderAuthenticationErrorMessage, requiresRiderAuthentication, riderResponseRequiresAuthentication } from "./apiAuthPolicy";

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

  it.each(["AUTHENTICATION_REQUIRED", "INVALID_TOKEN", "TOKEN_EXPIRED", "SESSION_EXPIRED", "PASSWORD_CHANGE_REQUIRED"])(
    "still requires reauthentication for the explicit code %s", async (code) => {
      for (const status of [401, 403, 428]) {
        expect(await requiresRiderAuthentication(apiResponse(status, { error: code }))).toBe(true);
        expect(isRiderAuthenticationErrorMessage(`API ${status}: ${JSON.stringify({ code })}`)).toBe(true);
      }
    },
  );

  it("preserves the token on generic proxy 401 and non-auth authorization errors", async () => {
    expect(await requiresRiderAuthentication(apiResponse(401, "<html>Unauthorized</html>", "text/html"))).toBe(false);
    expect(await requiresRiderAuthentication(apiResponse(401, { error: "UPSTREAM_UNAVAILABLE" }))).toBe(false);
    expect(await requiresRiderAuthentication(apiResponse(401, { message: "Unauthorized" }))).toBe(false);
    expect(await requiresRiderAuthentication(apiResponse(401, { error: "UPSTREAM_UNAVAILABLE", message: "Unauthorized" }))).toBe(false);
    expect(await requiresRiderAuthentication(apiResponse(403, { error: "RIDER_ACCESS_DENIED" }))).toBe(false);
    expect(await requiresRiderAuthentication(apiResponse(500, { error: "AUTHENTICATION_REQUIRED" }))).toBe(false);
  });

  it.each(["AUTHENTICATION_REQUIRED_UPSTREAM", "TOKEN_EXPIRED_OFFER", "SESSION_EXPIRED_ORDER", "UNAUTHORIZED_PROXY"])(
    "does not confuse the distinct error %s with invalid rider credentials", async (code) => {
      expect(await requiresRiderAuthentication(apiResponse(401, { error: code }))).toBe(false);
      expect(isRiderAuthenticationErrorMessage(`API 401: ${JSON.stringify({ code })}`)).toBe(false);
    },
  );

  it.each([401, 403])("rejects generic and suffixed proxy signals at HTTP %s in both structured fields", async status => {
    for (const field of ["error", "code"]) {
      for (const value of ["Unauthorized", "unauthorized", "UNAUTHORIZED", "AUTHENTICATION_REQUIRED:UPSTREAM", "AUTHENTICATION_REQUIRED_UPSTREAM", "AUTHENTICATION_REQUIRED-UPSTREAM", "authentication_required", "AUTHENTICATION REQUIRED", " AUTHENTICATION_REQUIRED "]) {
        const body = { [field]: value };
        expect(riderResponseRequiresAuthentication(status, body), JSON.stringify(body)).toBe(false);
        expect(await requiresRiderAuthentication(apiResponse(status, body)), JSON.stringify(body)).toBe(false);
        expect(isRiderAuthenticationErrorMessage(`API ${status}: ${JSON.stringify(body)}`), JSON.stringify(body)).toBe(false);
      }
    }
  });

  it("does not accept unstructured or coerced values as authentication codes", () => {
    for (const body of [null, [], [{ error: "AUTHENTICATION_REQUIRED" }], "AUTHENTICATION_REQUIRED", { error: { code: "AUTHENTICATION_REQUIRED" } }, { error: ["AUTHENTICATION_REQUIRED"] }, { message: "AUTHENTICATION_REQUIRED" }]) {
      expect(riderResponseRequiresAuthentication(401, body)).toBe(false);
    }
  });

  it("parses explicit auth codes from the API client's error message but not generic 401 text", () => {
    expect(isRiderAuthenticationErrorMessage('API 401: {"error":"AUTHENTICATION_REQUIRED"}')).toBe(true);
    expect(isRiderAuthenticationErrorMessage('API 401: Unauthorized')).toBe(false);
    expect(isRiderAuthenticationErrorMessage('API 403: {"error":"RIDER_ACCESS_DENIED"}')).toBe(false);
  });

  it("requires a recognized HTTP authentication status in API client error messages", () => {
    expect(isRiderAuthenticationErrorMessage('API 500: {"error":"AUTHENTICATION_REQUIRED"}')).toBe(false);
    expect(isRiderAuthenticationErrorMessage('API 409: {"error":"TOKEN_EXPIRED"}')).toBe(false);
    expect(isRiderAuthenticationErrorMessage('network: {"error":"AUTHENTICATION_REQUIRED"}')).toBe(false);
    expect(isRiderAuthenticationErrorMessage('API 428: {"error":"PASSWORD_CHANGE_REQUIRED"}')).toBe(true);
  });
});
