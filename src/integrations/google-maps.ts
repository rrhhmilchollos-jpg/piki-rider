let mapsPromise: Promise<typeof google.maps> | null = null;

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  const apiKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY no está configurada"));

  mapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-piki-google-maps="true"]');
    if (existing) {
      existing.addEventListener("load", () => window.google?.maps ? resolve(window.google.maps) : reject(new Error("Google Maps no se inicializó")));
      existing.addEventListener("error", () => reject(new Error("No se pudo cargar Google Maps")));
      return;
    }
    const script = document.createElement("script");
    script.dataset.pikiGoogleMaps = "true";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry&v=weekly`;
    script.onload = () => window.google?.maps ? resolve(window.google.maps) : reject(new Error("Google Maps no se inicializó"));
    script.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(script);
  });
  return mapsPromise;
}
