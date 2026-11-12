import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LiveGoogleMap from "./LiveGoogleMap";
import type { RiderGpsMapPoint } from "../riderGpsState";
const state = vi.hoisted(() => ({ point: null as RiderGpsMapPoint | null }));
vi.mock("leaflet", () => ({ default: {} }));
vi.mock("../riderGpsState", () => ({ useRiderGpsMapPoint: () => state.point }));
vi.mock("../riderGeofence", () => ({ ringsOf: () => [], useDeliveryZone: () => null }));
beforeEach(() => { state.point = null; });

describe("map is provider evidence, not GPS acknowledgement or eligibility", () => {
  it("does not claim an active GPS service just because the shift is active", () => {
    const html = renderToStaticMarkup(<LiveGoogleMap active/>);
    expect(html).toContain("Jornada activa · esperando la primera posición de este dispositivo");
    expect(html).toContain("puede ser una estimación sin GPS");
    expect(html).not.toContain("GPS activo");
  });
  it("does not claim a confirmed or genuine GPS merely from map centering", () => {
    state.point = { lat: 38.989, lng: -0.52, accuracy: 8 };
    const html = renderToStaticMarkup(<LiveGoogleMap active/>);
    expect(html).toContain("Posición del dispositivo recibida");
    expect(html).toContain("precisión aproximada ±8 m");
    expect(html).toContain("El mapa no acredita confirmación GPS reciente ni elegibilidad");
    expect(html).not.toMatch(/GPS confirmado por la API|posición real/);
  });
});
