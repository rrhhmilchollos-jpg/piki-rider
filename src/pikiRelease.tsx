import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PIKI_RELEASE } from "./release-meta";

type ReleasePolicy = {
  surface?: unknown;
  version?: unknown;
  minimumVersion?: unknown;
  buildId?: unknown;
  forceUpdate?: unknown;
  updateRequired?: unknown;
};

type GateState = "checking" | "ready" | "required" | "error";
type ValidPolicy = { surface: string; version?: unknown; minimumVersion: string; buildId: string; forceUpdate: boolean; updateRequired?: unknown };

const apiOrigin = (import.meta.env.VITE_API_URL ?? "https://api.pikidelivery.com").replace(/\/$/, "");
const apiHost = new URL(apiOrigin, window.location.origin).origin;
const requestTimeoutMs = 8_000;

function versionParts(value: string): number[] | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isNewer(candidate: string, current: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(current);
  if (!left || !right) return false;
  return left.some((part, index) => part !== right[index] && part > right[index]);
}

function isValidPolicy(value: ReleasePolicy): value is ValidPolicy {
  return value.surface === PIKI_RELEASE.surface
    && typeof value.minimumVersion === "string"
    && versionParts(value.minimumVersion) !== null
    && typeof value.buildId === "string"
    && typeof value.forceUpdate === "boolean";
}

async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  await registration.update();
  return registration;
}

async function waitForWaitingWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  if (registration.waiting) return registration.waiting;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(registration.waiting ?? null), 10_000);
    const inspect = () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" || worker.state === "activated" || worker.state === "redundant") {
          window.clearTimeout(timeout);
          resolve(registration.waiting ?? (worker.state === "activated" ? worker : null));
        }
      }, { once: true });
    };
    registration.addEventListener("updatefound", inspect, { once: true });
    inspect();
  });
}

async function waitForControllerChange(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 10_000);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function installPikiReleaseHeaders(): void {
  const state = window as unknown as { __pikiReleaseFetchInstalled?: boolean };
  if (state.__pikiReleaseFetchInstalled) return;
  state.__pikiReleaseFetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, window.location.origin);
    if (url.origin !== apiHost) return nativeFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set("X-PIKI-Surface", PIKI_RELEASE.surface);
    headers.set("X-PIKI-Client-Version", PIKI_RELEASE.version);
    headers.set("X-PIKI-Client-Build", PIKI_RELEASE.buildId);
    if (input instanceof Request) return nativeFetch(new Request(input, { ...init, headers }));
    return nativeFetch(input, { ...init, headers });
  };
}

async function fetchPolicy(): Promise<ReleasePolicy> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const query = new URLSearchParams({
      surface: PIKI_RELEASE.surface,
      clientVersion: PIKI_RELEASE.version,
      clientBuildId: PIKI_RELEASE.buildId,
    });
    const response = await fetch(`${apiOrigin}/api/v1/app-version?${query}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`VERSION_CHECK_${response.status}`);
    return await response.json() as ReleasePolicy;
  } finally {
    window.clearTimeout(timeout);
  }
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function storedEmployeeToken(): string | null {
  const key = `piki-${location.hostname}-api-token`;
  return sessionStorage.getItem(key) || localStorage.getItem(key);
}

async function syncPushSubscription(showNotification: boolean): Promise<string> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("Este navegador no admite notificaciones push.");
  const config = await fetch(`${apiOrigin}/api/v1/push/config`, { cache: "no-store", headers: { Accept: "application/json" } }).then(async (response) => {
    if (!response.ok) throw new Error("La configuración de avisos no está disponible.");
    return await response.json() as { enabled?: boolean; vapidPublicKey?: string };
  });
  if (!config.enabled || !config.vapidPublicKey) throw new Error("Los avisos todavía no están habilitados.");
  const permission = showNotification ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") throw new Error("No se concedió permiso para mostrar avisos.");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey).buffer as ArrayBuffer });
  const token = storedEmployeeToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-PIKI-Surface": PIKI_RELEASE.surface };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiOrigin}/api/v1/push/subscriptions`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error === "AUTHENTICATION_REQUIRED" ? "Inicia sesión antes de activar avisos." : body.error || "No se pudo guardar el dispositivo.");
  }
  return "Avisos activados correctamente.";
}

function PushConsentControl() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [supported] = useState(() => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  const enable = useCallback(async () => {
    setBusy(true);
    try { setMessage(await syncPushSubscription(true)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudieron activar los avisos."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    if (!supported) return;
    const listener = (event: MessageEvent) => {
      if (event.data?.type === "PIKI_PUSH_SUBSCRIPTION_CHANGED" && Notification.permission === "granted") void syncPushSubscription(false).catch(() => undefined);
    };
    navigator.serviceWorker.addEventListener("message", listener);
    return () => navigator.serviceWorker.removeEventListener("message", listener);
  }, [supported]);
  if (!supported) return null;
  return <aside aria-live="polite" style={{ position: "fixed", right: "16px", bottom: "16px", zIndex: 9999, maxWidth: "320px", padding: "12px", borderRadius: "12px", background: "#111827", color: "white", boxShadow: "0 10px 30px rgba(0,0,0,.25)" }}>
    <strong style={{ display: "block", marginBottom: "6px" }}>Avisos de PIKI</strong>
    <p style={{ fontSize: "13px", margin: "0 0 10px" }}>Activa notificaciones para recibir avisos operativos y de pedidos en este dispositivo.</p>
    <button type="button" onClick={() => void enable()} disabled={busy || Notification.permission === "denied"} style={{ padding: "8px 10px", borderRadius: "8px", border: 0, fontWeight: 700, cursor: "pointer" }}>
      {busy ? "Activando…" : Notification.permission === "denied" ? "Permiso bloqueado" : "Activar avisos"}
    </button>
    {message && <p style={{ fontSize: "12px", margin: "8px 0 0" }}>{message}</p>}
  </aside>;
}

export function PikiReleaseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [requiredVersion, setRequiredVersion] = useState("");
  const [detail, setDetail] = useState("");
  const [updating, setUpdating] = useState(false);

  const check = useCallback(async () => {
    try {
      await registerWorker();
      const policy = await fetchPolicy();
      if (!isValidPolicy(policy)) throw new Error("La política de versión no es válida.");
      const requiresUpdate = policy.forceUpdate && (policy.updateRequired === true || isNewer(policy.minimumVersion, PIKI_RELEASE.version));
      if (requiresUpdate) {
        setRequiredVersion(`${String(policy.version || policy.minimumVersion)} · ${policy.buildId}`);
        setState("required");
      } else {
        setState("ready");
      }
    } catch (error) {
      // The API independently rejects obsolete, versioned requests. The UI remains usable only
      // while the policy cannot be reached, avoiding a permanent client-side outage offline.
      setDetail(error instanceof Error ? error.message : "No se pudo comprobar la versión.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    installPikiReleaseHeaders();
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  const update = useCallback(async () => {
    setUpdating(true);
    setDetail("");
    try {
      const registration = await registerWorker();
      const waiting = registration ? await waitForWaitingWorker(registration) : null;
      if (waiting && waiting.state !== "activated") waiting.postMessage({ type: "SKIP_WAITING" });
      await waitForControllerChange();
      window.location.replace(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    } catch (error) {
      setUpdating(false);
      setDetail(error instanceof Error ? error.message : "No se pudo descargar la actualización.");
    }
  }, []);

  if (state === "checking") return <main aria-live="polite" style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui", padding: "24px" }}>Comprobando la versión segura de PIKI…</main>;
  if (state === "required") return <main aria-labelledby="piki-update-title" style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui", padding: "24px", background: "#f8fafc" }}><section role="dialog" aria-modal="true" style={{ maxWidth: "480px", padding: "28px", background: "white", borderRadius: "16px", boxShadow: "0 12px 40px rgba(15,23,42,.15)" }}><p style={{ fontWeight: 700, color: "#b45309" }}>PIKI · ACTUALIZACIÓN OBLIGATORIA</p><h1 id="piki-update-title">Actualiza para continuar</h1><p>Esta versión no puede utilizarse. Descargaremos la versión {requiredVersion} y recargaremos la aplicación sin perder tu sesión.</p>{detail && <p role="alert">{detail}</p>}<button type="button" onClick={() => void update()} disabled={updating} style={{ padding: "12px 16px", border: 0, borderRadius: "9px", background: "#111827", color: "white", fontWeight: 700 }}>{updating ? "Actualizando…" : "Actualizar ahora"}</button></section></main>;
  return <>{state === "error" && <div role="status" style={{ position: "fixed", zIndex: 9998, top: 0, left: 0, right: 0, padding: "8px", textAlign: "center", background: "#fef3c7", color: "#78350f", fontSize: "13px" }}>No se ha podido comprobar la versión: {detail}</div>}{children}<PushConsentControl /></>;
}
