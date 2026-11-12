import { describe, expect, it } from "vitest";
import { isRiderGpsLocationAck, riderGpsHttpFailureDetail, riderGpsResponseCode, riderGpsTransportFailureDetail } from "./riderGpsResponse";
const point = { latitude: 38.989, longitude: -0.52, accuracy: 8 };
const ack = () => ({ rider: { id: "offline-rider", status: "offline", location: { type: "Point", coordinates: [point.longitude, point.latitude] }, lastLocationAt: "2026-11-12T14:26:26.128Z" } });

describe("legacy per-device POST confirmation evidence", () => {
  it("accepts the real nested ACK independently of availability or geofence eligibility", () => {
    expect(isRiderGpsLocationAck(ack(), "offline-rider", point)).toBe(true);
  });
  it.each([
    undefined, {}, "<html>OK</html>", { accepted: ["sample-1"], duplicates: [], rejected: [] },
    { rider: { ...ack().rider, id: "another-rider" } },
    { rider: { ...ack().rider, lastLocationAt: null } },
    { rider: { ...ack().rider, lastLocationAt: "not-a-date" } },
    { rider: { ...ack().rider, location: { type: "Point", coordinates: [0, 0] } } },
    { rider: { ...ack().rider, location: { type: "Point", coordinates: [String(point.longitude), point.latitude] } } },
  ])("does not turn an unrelated or malformed payload into GPS confirmation: %j", (body) => {
    expect(isRiderGpsLocationAck(body, "offline-rider", point)).toBe(false);
  });
  it("does not expose arbitrary strings, tokens, coordinates or server messages", () => {
    const body = { error: "TOKEN_private@example.invalid", code: "38.989,-0.52", message: "Bearer sensitive-token" };
    expect(riderGpsResponseCode(body)).toBeUndefined();
    expect(riderGpsHttpFailureDetail(503, body)).toContain("HTTP 503");
    expect(riderGpsHttpFailureDetail(503, body)).not.toMatch(/private@|38\.989|sensitive-token/);
  });
  it("can read an allowlisted code field without exposing the free-text error", () => {
    expect(riderGpsResponseCode({ error: "private", code: "INVALID_LOCATION" })).toBe("INVALID_LOCATION");
  });
  it("distinguishes an aborted transport from HTTP and hides its raw exception", () => {
    const failure = Object.assign(new Error("token coordinates and private URL"), { name: "TimeoutError" });
    expect(riderGpsTransportFailureDetail(failure)).toContain("agotó el tiempo de espera");
    expect(riderGpsTransportFailureDetail(failure)).not.toContain(failure.message);
    expect(riderGpsTransportFailureDetail(new Error("private URL"))).toContain("causa HTTP no está disponible");
  });
});
