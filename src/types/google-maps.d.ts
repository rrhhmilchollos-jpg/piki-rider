declare namespace google {
  namespace maps {
    class Map {
      constructor(element: HTMLElement, options?: Record<string, unknown>);
      setCenter(center: LatLngLiteral): void;
      setZoom(zoom: number): void;
    }
    class Marker {
      constructor(options?: Record<string, unknown>);
      setPosition(position: LatLngLiteral): void;
      setMap(map: Map | null): void;
    }
    class Polygon {
      constructor(options?: Record<string, unknown>);
      setMap(map: Map | null): void;
    }
    class LatLng {
      constructor(lat: number | LatLngLiteral, lng?: number);
    }
    type LatLngLiteral = { lat: number; lng: number };
    namespace geometry { namespace poly { function containsLocation(point: LatLng, polygon: Polygon): boolean; } }
  }
}
