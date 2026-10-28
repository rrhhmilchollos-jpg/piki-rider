import { afterEach, describe, expect, it, vi } from "vitest";
import { toGoogleZonePaths, zoneForPoint } from "./zone-coverage";
import type { ZonePath } from "./zone-coverage";
import type { OperationalZone } from "../integrations/piki-api";

const square = (west: number, south: number, east: number, north: number): number[][] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

class FakePolygon {
  readonly options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    this.options = options;
  }
}

class FakeLatLng {
  readonly point: { lat: number; lng: number };

  constructor(point: { lat: number; lng: number }) {
    this.point = point;
  }
}

function isInsideRing(point: { lat: number; lng: number }, ring: { lat: number; lng: number }[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = (a.lat > point.lat) !== (b.lat > point.lat)
      && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

const containsLocation = vi.fn((point: FakeLatLng, polygon: FakePolygon) => {
  return isInsideRing(point.point, polygon.options.paths as { lat: number; lng: number }[]);
});

function installGoogleMapsFake() {
  vi.stubGlobal("google", {
    maps: {
      Polygon: FakePolygon,
      LatLng: FakeLatLng,
      geometry: { poly: { containsLocation } },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  containsLocation.mockClear();
});

describe("cobertura de zonas operativas", () => {
  it("convierte Polygon y conserva exterior más anillos interiores en paths", () => {
    const zone: OperationalZone = {
      slug: "center",
      name: "Centro",
      polygon: {
        type: "Polygon",
        coordinates: [square(0, 0, 10, 10), square(3, 3, 7, 7)],
      },
    };

    const result = toGoogleZonePaths([zone]);
    expect(result).toHaveLength(1);
    expect(result[0].zone).toBe(zone);
    expect(result[0].path[0]).toEqual({ lat: 0, lng: 0 });
    expect(result[0].paths).toHaveLength(2);
    expect(result[0].paths?.[1][0]).toEqual({ lat: 3, lng: 3 });
  });

  it("crea un entry independiente por componente MultiPolygon", () => {
    const zone: OperationalZone = {
      slug: "islands",
      name: "Islas",
      polygon: {
        type: "MultiPolygon",
        coordinates: [
          [square(0, 0, 10, 10)],
          [square(20, 20, 30, 30), square(22, 22, 24, 24)],
        ],
      },
    };

    const result = toGoogleZonePaths([zone]);
    expect(result).toHaveLength(2);
    expect(result.map(({ path }) => path[0])).toEqual([
      { lat: 0, lng: 0 },
      { lat: 20, lng: 20 },
    ]);
    expect(result[1].paths).toHaveLength(2);
  });

  it("omite zonas inactivas y componentes con coordenadas invalidas o anillos demasiado cortos", () => {
    const zones: OperationalZone[] = [
      {
        slug: "inactive",
        name: "Inactiva",
        isActive: false,
        polygon: { type: "Polygon", coordinates: [square(0, 0, 10, 10)] },
      },
      {
        slug: "invalid",
        name: "Inválida",
        polygon: {
          type: "Polygon",
          coordinates: [square(0, 0, 10, 10), [[1, 1], [2, 2], [Number.NaN, 3]]],
        },
      },
      {
        slug: "short",
        name: "Corta",
        polygon: { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] },
      },
      {
        slug: "partial",
        name: "Parcial",
        polygon: {
          type: "MultiPolygon",
          coordinates: [[square(40, 40, 50, 50)], [[[60, 60], [61, 61]]]],
        },
      },
    ];

    expect(toGoogleZonePaths(zones).map(({ zone }) => zone.slug)).toEqual(["partial"]);
  });

  it("no considera cubierta la zona cuando el punto cae en un hole", () => {
    installGoogleMapsFake();
    const zone: OperationalZone = {
      slug: "center",
      name: "Centro",
      polygon: {
        type: "Polygon",
        coordinates: [square(0, 0, 10, 10), square(3, 3, 7, 7)],
      },
    };
    const [path] = toGoogleZonePaths([zone]);

    expect(zoneForPoint({ lat: 5, lng: 5 }, [path])).toBeNull();
    expect(containsLocation).toHaveBeenCalledTimes(2);
    expect(zoneForPoint({ lat: 1, lng: 1 }, [path])).toBe(zone);
  });

  it("encuentra cualquier componente MultiPolygon y nunca cubre una zona inactiva", () => {
    installGoogleMapsFake();
    const zone: OperationalZone = {
      slug: "islands",
      name: "Islas",
      polygon: {
        type: "MultiPolygon",
        coordinates: [[square(0, 0, 10, 10)], [square(20, 20, 30, 30)]],
      },
    };
    const components: ZonePath[] = toGoogleZonePaths([zone]);

    expect(components).toHaveLength(2);
    expect(zoneForPoint({ lat: 25, lng: 25 }, components)).toBe(zone);
    expect(zoneForPoint({ lat: 25, lng: 25 }, components.map((item) => ({ ...item, zone: { ...zone, isActive: false } })))).toBeNull();
  });
});
