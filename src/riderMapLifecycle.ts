export type RiderMapTileState = "idle" | "loading" | "ready" | "partial" | "error";

/** Layout recovery only: does not read GPS, change a view or call the Rider API. */
export function observeRiderMapLayout(node: HTMLElement, map: { invalidateSize: (options: { pan: boolean }) => unknown }): () => void {
  let closed = false;
  const invalidate = () => {
    if (!closed && document.visibilityState === "visible" && node.clientWidth > 0 && node.clientHeight > 0) {
      map.invalidateSize({ pan: false });
    }
  };
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(invalidate);
  observer?.observe(node);
  document.addEventListener("visibilitychange", invalidate);
  return () => {
    closed = true;
    observer?.disconnect();
    document.removeEventListener("visibilitychange", invalidate);
  };
}

type TileEvents = { on: (event: string, listener: () => void) => unknown; off: (event: string, listener: () => void) => unknown };

/** Leaflet image error events do not disclose a reliable HTTP status/cause. */
export function observeRiderMapTiles(layer: TileEvents, onChange: (state: RiderMapTileState) => void): () => void {
  let loaded = 0;
  let failed = 0;
  let closed = false;
  const emit = (state: RiderMapTileState) => { if (!closed) onChange(state); };
  const handlers: Record<string, () => void> = {
    loading: () => { loaded = 0; failed = 0; emit("loading"); },
    tileload: () => { loaded += 1; },
    tileerror: () => { failed += 1; emit(loaded ? "partial" : "error"); },
    load: () => { emit(failed ? loaded ? "partial" : "error" : loaded ? "ready" : "idle"); },
  };
  for (const [event, listener] of Object.entries(handlers)) layer.on(event, listener);
  return () => {
    closed = true;
    for (const [event, listener] of Object.entries(handlers)) layer.off(event, listener);
  };
}

export function riderMapTileDetail(state: RiderMapTileState): string {
  if (state === "loading") return "Cargando el mapa… Esto no confirma ni rechaza el envío GPS.";
  if (state === "error" || state === "partial") return "No se han podido cargar algunas imágenes del mapa. No se conoce su causa HTTP; este fallo visual no confirma ni rechaza el envío GPS.";
  return "";
}
