import { RiderGpsPermissionError, type GpsCallbacks } from "./riderGpsTracker";

// A removed session cannot cancel getCurrentPosition. Keep the guard across
// tracker restarts until that actual request settles, rather than duplicating it.
let browserRequestPending = false;

/** Only runs while visible; browser/OS suspension is not a background GPS service. */
export function watchRiderBrowserGps(callbacks: GpsCallbacks): () => void {
  const geolocation = navigator.geolocation;
  if (!geolocation) throw new Error("Este navegador no ofrece ubicación. Usa HTTPS o el APK Android.");
  const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };
  let closed = false;
  let visibleGeneration = 0;
  let watchId: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  // getCurrentPosition cannot be cancelled. Do not replace an outstanding request
  // on another tick or hide/show; its eventual callback releases this guard.
  const current = () => !closed && callbacks.isCurrent() && document.visibilityState === "visible";
  const pause = () => {
    ++visibleGeneration;
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (watchId !== null) geolocation.clearWatch(watchId);
    watchId = null;
  };
  const remove = () => {
    closed = true;
    pause();
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
  const receive = (position: GeolocationPosition, generation: number, requestedAt?: number) => {
    if (!current() || generation !== visibleGeneration) return;
    // Keep the provider's timestamp. Never relabel a cached fix as a new one.
    if (requestedAt !== undefined && position.timestamp < requestedAt) return;
    callbacks.onLocation({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      heading: typeof position.coords.heading === "number" && Number.isFinite(position.coords.heading) && position.coords.heading >= 0 ? position.coords.heading : undefined,
      timestamp: position.timestamp,
    });
  };
  const fail = (error: GeolocationPositionError, generation: number) => {
    if (closed || !callbacks.isCurrent()) return;
    // A denial is terminal even if a pending request finishes after hiding.
    if (error.code === 1) {
      remove();
      callbacks.onError(new RiderGpsPermissionError("No has permitido la ubicación de PIKI Riders."));
    } else if (current() && generation === visibleGeneration) {
      callbacks.onError(new Error("No se pudo obtener una posición GPS. Vuelve a intentarlo."));
    }
  };
  const browserError = (error: unknown) => error instanceof Error && (error.name === "SecurityError" || error.name === "NotAllowedError")
    ? new RiderGpsPermissionError("No has permitido la ubicación de PIKI Riders.")
    : error instanceof Error ? error : new Error("No se pudo solicitar el GPS.");
  const requestFix = () => {
    if (!current() || browserRequestPending) return;
    browserRequestPending = true;
    const generation = visibleGeneration;
    const requestedAt = Date.now();
    let settled = false;
    const complete = () => {
      if (settled) return false;
      settled = true;
      browserRequestPending = false;
      return true;
    };
    try {
      geolocation.getCurrentPosition(
        (position) => { if (complete()) receive(position, generation, requestedAt); },
        (error) => { if (complete()) fail(error, generation); },
        options,
      );
    } catch (error) {
      if (complete() && current()) {
        const failure = browserError(error);
        if (failure instanceof RiderGpsPermissionError) remove();
        callbacks.onError(failure);
      }
    }
  };
  const activate = () => {
    if (!current() || watchId !== null) return;
    const generation = visibleGeneration;
    try {
      const id = geolocation.watchPosition(
        (position) => receive(position, generation),
        (error) => fail(error, generation),
        options,
      );
      // Also handles a synchronous mock/provider callback denying permission.
      if (!current() || generation !== visibleGeneration) geolocation.clearWatch(id);
      else {
        watchId = id;
        timer = setInterval(requestFix, 30_000);
      }
    } catch (error) {
      remove();
      callbacks.onError(browserError(error));
    }
  };
  function visibilityChanged() {
    if (!current()) pause();
    else activate();
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  activate();
  return remove;
}
