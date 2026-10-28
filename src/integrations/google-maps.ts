let mapsPromise: Promise<typeof google.maps> | null = null;
let mapsAuthFailed = false;

type GoogleMapsWindow = Window & { gm_authFailure?: () => void };

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (mapsAuthFailed) return Promise.reject(new Error("GOOGLE_MAPS_AUTH_FAILURE"));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  const apiKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY no está configurada"));

  mapsPromise = new Promise((resolve, reject) => {
    const mapsWindow = window as GoogleMapsWindow;
    const previousAuthFailure = mapsWindow.gm_authFailure;
    let authFailure: (() => void) | null = null;
    let script: HTMLScriptElement | null = null;
    let settled = false;
    let timeoutId = 0;

    const restoreAuthFailure = () => {
      if (mapsWindow.gm_authFailure !== authFailure) return;
      if (previousAuthFailure) mapsWindow.gm_authFailure = previousAuthFailure;
      else delete mapsWindow.gm_authFailure;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      script?.remove();
      restoreAuthFailure();
      mapsPromise = null;
      reject(error);
    };
    const finish = () => {
      if (settled) return;
      const maps = window.google?.maps;
      if (!maps) {
        fail(new Error("Google Maps no se inicializó"));
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(maps);
    };

    authFailure = () => {
      mapsAuthFailed = true;
      try {
        window.dispatchEvent(new Event("piki-google-maps-auth-failure"));
        try { previousAuthFailure?.(); } catch { /* Do not suppress the app's own auth-failure state. */ }
      } finally {
        if (settled) {
          script?.remove();
          restoreAuthFailure();
          mapsPromise = null;
        } else {
          fail(new Error("GOOGLE_MAPS_AUTH_FAILURE"));
        }
      }
    };
    mapsWindow.gm_authFailure = authFailure;
    timeoutId = window.setTimeout(() => fail(new Error("GOOGLE_MAPS_TIMEOUT")), 15_000);

    const existing = document.querySelector<HTMLScriptElement>('script[data-piki-google-maps="true"]');
    if (existing) {
      script = existing;
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => fail(new Error("No se pudo cargar Google Maps")), { once: true });
      return;
    }
    script = document.createElement("script");
    script.dataset.pikiGoogleMaps = "true";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry&v=weekly`;
    script.onload = finish;
    script.onerror = () => fail(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(script);
  });
  return mapsPromise;
}
