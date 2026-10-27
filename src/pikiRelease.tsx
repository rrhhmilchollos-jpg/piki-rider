import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PIKI_RELEASE } from "./release-meta";
import { shouldShowPushConsent } from "./pushConsentPolicy";
import { getPwaOperationSafety, subscribePwaOperationSafety } from "./pwaOperationSafety";
import {
  canReloadAfterControllerChange,
  getRequiredPwaUpdate,
  pwaReloadMarker,
  shouldDeferPwaActivation,
  type ReleasePolicy,
  type UpdateRequirement,
} from "./pwaUpdateRecovery";

type GateState = "checking" | "ready" | "required" | "error";

const apiOrigin = (import.meta.env.VITE_API_URL ?? "https://api.pikidelivery.com").replace(/\/$/, "");
const apiHost = new URL(apiOrigin, window.location.origin).origin;
const requestTimeoutMs = 8_000;

async function registerWorker(checkForUpdate = true): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    if (checkForUpdate) {
      try { await registration.update(); } catch { /* Un SW antiguo o una red móvil no debe bloquear la app. */ }
    }
    return registration;
  } catch {
    // La aplicación sigue funcionando aunque Android tarde en actualizar el SW.
    return null;
  }
}

function waitForWaitingWorker(registration: ServiceWorkerRegistration, timeoutMs = 20_000): Promise<ServiceWorker | null> {
  if (registration.waiting) return Promise.resolve(registration.waiting);
  return new Promise((resolve) => {
    let settled = false;
    let installing: ServiceWorker | null = null;
    let timeout: number | undefined;
    const finish = (worker: ServiceWorker | null) => {
      if (settled) return;
      settled = true;
      registration.removeEventListener("updatefound", inspect);
      installing?.removeEventListener("statechange", inspect);
      if (timeout !== undefined) window.clearTimeout(timeout);
      resolve(worker);
    };
    const inspect = () => {
      if (registration.waiting) {
        finish(registration.waiting);
        return;
      }
      const nextInstalling = registration.installing;
      if (nextInstalling !== installing) {
        installing?.removeEventListener("statechange", inspect);
        installing = nextInstalling;
        installing?.addEventListener("statechange", inspect);
      }
      if (installing?.state === "installed") finish(registration.waiting ?? installing);
      else if (installing?.state === "redundant") finish(null);
    };
    registration.addEventListener("updatefound", inspect);
    timeout = window.setTimeout(() => finish(registration.waiting), timeoutMs);
    inspect();
  });
}

// oxlint-disable-next-line react/only-export-components
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
function uint8ArrayToBase64Url(value: Uint8Array): string {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function subscriptionUsesVapidKey(subscription: PushSubscription, vapidPublicKey: string): boolean | null {
  const applicationServerKey = subscription.options.applicationServerKey;
  if (!applicationServerKey) return null;
  const bytes = applicationServerKey instanceof ArrayBuffer ? new Uint8Array(applicationServerKey) : new Uint8Array(applicationServerKey);
  return uint8ArrayToBase64Url(bytes) === vapidPublicKey;
}

function storedEmployeeToken(): string | null {
  const key = `piki-${location.hostname}-api-token`;
  return sessionStorage.getItem(key) || localStorage.getItem(key);
}

function hasValidatedEmployeeSession(): boolean {
  return Boolean(storedEmployeeToken() && sessionStorage.getItem(`piki-${location.hostname}-employee-session-validated`) === "1");
}

async function syncPushSubscription(showNotification: boolean): Promise<string> {
  if (!hasValidatedEmployeeSession()) throw new Error("Inicia sesión antes de activar avisos.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("Este navegador no admite notificaciones push.");
  const config = await fetch(`${apiOrigin}/api/v1/push/config`, { cache: "no-store", headers: { Accept: "application/json" } }).then(async (response) => {
    if (!response.ok) throw new Error("La configuración de avisos no está disponible.");
    return await response.json() as { enabled?: boolean; vapidPublicKey?: string };
  });
  if (!config.enabled || !config.vapidPublicKey) throw new Error("Los avisos todavía no están habilitados.");
  const permission = showNotification ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") throw new Error("No se concedió permiso para mostrar avisos.");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // A VAPID key rotation invalidates old browser subscriptions and causes provider 403s.
  // Renew the subscription before saving it so the Rider can receive new offers again.
  if (subscription && subscriptionUsesVapidKey(subscription, config.vapidPublicKey) === false) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey).buffer as ArrayBuffer });
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
  const [authEpoch, setAuthEpoch] = useState(0);
  const [supported] = useState(() => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  const [visible, setVisible] = useState(false);
  const customerSurface: boolean = String(PIKI_RELEASE.surface) === "customer";
  useEffect(() => {
    const wake = () => setAuthEpoch((value) => value + 1);
    window.addEventListener("piki-authenticated", wake);
    return () => window.removeEventListener("piki-authenticated", wake);
  }, []);
  useEffect(() => {
    if (!supported) return;
    const authenticated = customerSurface || hasValidatedEmployeeSession();
    const permission = "Notification" in window ? Notification.permission : "default";
    if (!shouldShowPushConsent({ supported, authenticated, permission })) {
      // Browser permission is authoritative; hide the card even if background sync fails.
      // oxlint-disable-next-line react/set-state-in-effect
      setVisible(false);
      if (authenticated && permission === "granted") {
        void syncPushSubscription(false).catch((error) => console.warn("No se pudo sincronizar la suscripción de avisos.", error));
      }
      return;
    }
    // The consent card is actionable only while browser permission is undecided.
    setVisible(true);
  }, [authEpoch, customerSurface, supported]);
  const enable = useCallback(async () => {
    setBusy(true); setMessage("");
    try { await syncPushSubscription(true); setMessage(""); setVisible(false); }
    catch (error) {
      const permission = "Notification" in window ? Notification.permission : "default";
      if (permission === "default") { setMessage(error instanceof Error ? error.message : "No se pudieron activar los avisos."); setVisible(true); }
      else { setMessage(""); setVisible(false); console.warn("No se pudo registrar este dispositivo para avisos.", error); }
    }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    if (!supported) return;
    const listener = (event: MessageEvent) => {
      if (event.data?.type === "PIKI_PUSH_SUBSCRIPTION_CHANGED" && Notification.permission === "granted" && hasValidatedEmployeeSession()) void syncPushSubscription(false).catch((error) => {
          console.warn("No se pudo resincronizar la suscripción de avisos.", error);
          setMessage("");
          setVisible(false);
        });
    };
    navigator.serviceWorker.addEventListener("message", listener);
    return () => navigator.serviceWorker.removeEventListener("message", listener);
  }, [supported]);
  if (!supported || !visible) return null;
  return <aside aria-live="polite" style={{ position: "fixed", right: "16px", bottom: "16px", zIndex: 9999, maxWidth: "320px", padding: "12px", borderRadius: "12px", background: "#111827", color: "white", boxShadow: "0 10px 30px rgba(0,0,0,.25)" }}>
    <button type="button" onClick={() => setVisible(false)} aria-label="Cerrar aviso de PIKI" style={{ float: "right", border: 0, background: "transparent", color: "white", fontSize: "20px", lineHeight: 1, cursor: "pointer" }}>×</button>
    <strong style={{ display: "block", marginBottom: "6px" }}>Avisos de PIKI</strong>
    <p style={{ fontSize: "13px", margin: "0 24px 10px 0" }}>Activa notificaciones para recibir avisos operativos y de pedidos en este dispositivo.</p>
    <button type="button" onClick={() => void enable()} disabled={busy} style={{ padding: "8px 10px", borderRadius: "8px", border: 0, fontWeight: 700, cursor: "pointer" }}>{busy ? "Activando…" : "Activar avisos"}</button>
    {message && <p style={{ fontSize: "12px", margin: "8px 0 0" }}>{message}</p>}
  </aside>;
}

export function PikiReleaseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("ready");
  const [requiredVersion, setRequiredVersion] = useState("");
  const [detail, setDetail] = useState("");
  const [updating, setUpdating] = useState(false);
  const requirementRef = useRef<UpdateRequirement | null>(null);
  const safetyRef = useRef(getPwaOperationSafety());
  const activationRequestedRef = useRef(false);
  const controllerChangedRef = useRef(false);

  const showRequirementWhenSafe = useCallback(() => {
    const requirement = requirementRef.current;
    if (!requirement || shouldDeferPwaActivation(safetyRef.current)) return;
    setRequiredVersion(`${requirement.targetVersion} · ${requirement.targetBuildId}`);
    setState("required");
  }, []);

  const reloadAfterControllerChange = useCallback(() => {
    const requirement = requirementRef.current;
    if (!requirement || !controllerChangedRef.current) return;
    const marker = pwaReloadMarker(requirement.targetBuildId);
    const alreadyReloadedForTarget = sessionStorage.getItem(marker) === "1";
    if (canReloadAfterControllerChange({
      activationRequested: activationRequestedRef.current,
      safety: safetyRef.current,
      alreadyReloadedForTarget,
    })) {
      sessionStorage.setItem(marker, "1");
      const url = new URL(window.location.href);
      url.searchParams.set("piki_build", requirement.targetBuildId);
      window.location.replace(url.toString());
      return;
    }
    if (activationRequestedRef.current && alreadyReloadedForTarget) {
      setUpdating(false);
      setDetail("El nuevo build PWA aún no se ha cargado. Cierra y vuelve a abrir PIKI Riders cuando tengas conexión.");
    }
  }, []);

  const check = useCallback(async () => {
    try {
      await registerWorker();
      const policy = await fetchPolicy();
      const requirement = getRequiredPwaUpdate(policy, PIKI_RELEASE, PIKI_RELEASE.surface);
      requirementRef.current = requirement;
      if (requirement) {
        if (shouldDeferPwaActivation(safetyRef.current)) {
          // Do not cover an active delivery, payment collection, or form with an update gate.
          setState("ready");
        } else {
          showRequirementWhenSafe();
        }
      } else {
        setState("ready");
      }
    } catch (error) {
      // The API independently rejects obsolete, versioned requests. The UI remains usable only
      // while the policy cannot be reached, avoiding a permanent client-side outage offline.
      setDetail(error instanceof Error ? error.message : "No se pudo comprobar la versión.");
      setState("error");
    }
  }, [showRequirementWhenSafe]);

  useEffect(() => {
    installPikiReleaseHeaders();
    // oxlint-disable-next-line react/set-state-in-effect
    void check();
    const onFocus = () => void check();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void check();
    };
    const unsubscribeSafety = subscribePwaOperationSafety((safety) => {
      safetyRef.current = safety;
      if (!shouldDeferPwaActivation(safety)) {
        showRequirementWhenSafe();
        reloadAfterControllerChange();
      }
    });
    const onControllerChange = () => {
      controllerChangedRef.current = true;
      reloadAfterControllerChange();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);
    const timer = window.setInterval(() => void check(), 5 * 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
      unsubscribeSafety();
      window.clearInterval(timer);
    };
  }, [check, reloadAfterControllerChange, showRequirementWhenSafe]);

  const update = useCallback(async () => {
    setUpdating(true);
    setDetail("");
    try {
      if (shouldDeferPwaActivation(safetyRef.current)) {
        setUpdating(false);
        setDetail("Terminaremos la actualización cuando acabes la entrega, el cobro o el formulario en curso.");
        return;
      }
      const registration = await registerWorker(false);
      if (!registration) {
        setUpdating(false);
        setDetail("No se pudo iniciar el servicio de actualización. Comprueba tu conexión y vuelve a intentarlo.");
        return;
      }
      let waiting = registration.waiting ?? null;
      if (!waiting) {
        const installation = waitForWaitingWorker(registration);
        try { await registration.update(); } catch { /* El tiempo de espera mostrará un mensaje recuperable. */ }
        waiting = registration.waiting ?? await installation;
      }
      if (!waiting) {
        setUpdating(false);
        setDetail("La descarga aún no ha terminado. Mantén Rider abierto con conexión y vuelve a intentarlo; no se han borrado tus datos.");
        return;
      }
      activationRequestedRef.current = true;
      waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (error) {
      setUpdating(false);
      setDetail(error instanceof Error ? error.message : "No se pudo descargar la actualización.");
    }
  }, []);

  if (state === "required") return <main aria-labelledby="piki-update-title" style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui", padding: "24px", background: "#f8fafc" }}><section role="dialog" aria-modal="true" style={{ maxWidth: "480px", padding: "28px", background: "white", borderRadius: "16px", boxShadow: "0 12px 40px rgba(15,23,42,.15)" }}><p style={{ fontWeight: 700, color: "#b45309" }}>PIKI RIDERS · ACTUALIZACIÓN PWA</p><h1 id="piki-update-title">Hay una nueva versión lista</h1><p>El nuevo build {requiredVersion} se descargará desde esta web y se aplicará sin cerrar tu sesión ni borrar los datos guardados.</p>{detail && <p role="alert">{detail}</p>}<button type="button" onClick={() => void update()} disabled={updating} style={{ padding: "12px 16px", border: 0, borderRadius: "9px", background: "#111827", color: "white", fontWeight: 700 }}>{updating ? "Aplicando nuevo build…" : "Actualizar PWA"}</button></section></main>;
  return <>{state === "error" && <div role="status" style={{ position: "fixed", zIndex: 9998, top: 0, left: 0, right: 0, padding: "8px", textAlign: "center", background: "#fef3c7", color: "#78350f", fontSize: "13px" }}>Conexión de seguridad temporalmente no disponible. Puedes iniciar sesión; lo volveremos a comprobar automáticamente.</div>}{children}<PushConsentControl /></>;
}
