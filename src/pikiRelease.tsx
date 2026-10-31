import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PIKI_RELEASE } from "./release-meta";
import { resolvePikiApiOrigin } from "./apiOrigin";
import { shouldShowPushConsent } from "./pushConsentPolicy";
import { getPwaOperationSafety, subscribePwaOperationSafety } from "./pwaOperationSafety";
import {
  shouldDeferPwaActivation,
  type ReleasePolicy,
} from "./pwaUpdateRecovery";
import {
  apiRequiresPikiSecurityUpdate,
  canNavigateToPikiTarget,
  fetchPikiStaticRelease,
  getPikiWebTarget,
  isPikiNativePwaGuard,
  markPikiTargetNavigation,
  pikiTargetNavigationUrl,
  shouldCheckPikiVersion,
  waitForPikiControllerChange,
  waitForPikiWaitingWorker,
  type PikiPwaTarget,
} from "./pikiPwaUpdate";

type GateState = "checking" | "ready" | "required" | "error";

const apiOrigin = resolvePikiApiOrigin(import.meta.env.VITE_API_URL);
const apiHost = new URL(apiOrigin, window.location.origin).origin;
const requestTimeoutMs = 8_000;
const workerActivationTimeoutMs = 10_000;
const nativeApp = Capacitor.isNativePlatform();

async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (isPikiNativePwaGuard(nativeApp) || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    return registration;
  } catch {
    // La aplicación sigue funcionando aunque Android tarde en actualizar el SW.
    return null;
  }
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
  if (nativeApp) throw new Error("Los avisos nativos se registran con la aplicación firmada; esta PWA no esperará un Service Worker.");
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
  const [supported] = useState(() => !nativeApp && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
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
    <p style={{ fontSize: "13px", margin: "0 24px 10px 0" }}>Activa avisos de pedidos, turnos, incentivos, soporte y cuenta en este dispositivo. La ubicación solo se solicita al iniciar una jornada; no es un requisito para las notificaciones.</p>
    <button type="button" onClick={() => void enable()} disabled={busy} style={{ padding: "8px 10px", borderRadius: "8px", border: 0, fontWeight: 700, cursor: "pointer" }}>{busy ? "Activando…" : "Activar avisos"}</button>
    {message && <p style={{ fontSize: "12px", margin: "8px 0 0" }}>{message}</p>}
  </aside>;
}

export function PikiReleaseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [requiredVersion, setRequiredVersion] = useState("");
  const [availableBuild, setAvailableBuild] = useState("");
  const [detail, setDetail] = useState("");
  const [updating, setUpdating] = useState(false);
  const [nativeSecurityUpdate, setNativeSecurityUpdate] = useState(false);
  const targetRef = useRef<PikiPwaTarget | null>(null);
  const registrationRef = useRef<Promise<ServiceWorkerRegistration | null> | null>(null);
  const checkInFlightRef = useRef<Promise<void> | null>(null);
  const lastCheckAtRef = useRef(0);
  const safetyRef = useRef(getPwaOperationSafety());
  const activationRequestedRef = useRef(false);
  const controllerChangedRef = useRef(false);

  const getRegistration = useCallback(async () => {
    if (!registrationRef.current) registrationRef.current = registerWorker();
    const registration = await registrationRef.current;
    if (!registration) registrationRef.current = null;
    return registration;
  }, []);

  const navigateToTarget = useCallback((target: PikiPwaTarget | null, manualRetry = false) => {
    if (shouldDeferPwaActivation(safetyRef.current)) {
      setDetail("Terminaremos la actualización cuando acabes la entrega, el cobro o el formulario en curso.");
      return false;
    }
    if (!canNavigateToPikiTarget({ target, current: PIKI_RELEASE, online: navigator.onLine, safe: true, storage: sessionStorage, manualRetry })) {
      setUpdating(false);
      setDetail(target ? "Este build ya se intentó cargar. Vuelve a intentarlo manualmente cuando termine el despliegue." : "No se ha confirmado un build web nuevo.");
      return false;
    }
    markPikiTargetNavigation(sessionStorage, PIKI_RELEASE.surface, target!.buildId);
    window.location.replace(pikiTargetNavigationUrl(window.location.href, target!.buildId));
    return true;
  }, []);

  const check = useCallback(async (reason: "initial" | "focus" | "visible" | "interval" | "manual") => {
    if (!shouldCheckPikiVersion({ now: Date.now(), lastCheckedAt: lastCheckAtRef.current, visible: document.visibilityState === "visible", reason, needsDeferredActivation: state === "required" })) return;
    if (checkInFlightRef.current) return checkInFlightRef.current;
    const work = (async () => {
      lastCheckAtRef.current = Date.now();
      try {
        const policy = await fetchPolicy();
        const securityRequired = apiRequiresPikiSecurityUpdate(policy, PIKI_RELEASE);
        const label = `${String(policy.version || policy.minimumVersion)} · ${String(policy.buildId || "")}`;
        if (nativeApp) {
          setNativeSecurityUpdate(securityRequired);
          setRequiredVersion(label);
          setState(securityRequired ? "required" : "ready");
          return;
        }
        const release = await fetchPikiStaticRelease(window.fetch.bind(window), window.location.origin, PIKI_RELEASE.surface);
        const target = getPikiWebTarget(release, PIKI_RELEASE);
        targetRef.current = target;
        setAvailableBuild(target ? `${target.version} · ${target.buildId}` : "");
        setNativeSecurityUpdate(false);
        if (securityRequired && !shouldDeferPwaActivation(safetyRef.current)) {
          setRequiredVersion(label);
          setState("required");
        } else {
          setState("ready");
          if (target) void getRegistration();
        }
      } catch (error) {
        setDetail(error instanceof Error ? error.message : "No se pudo comprobar la versión.");
        setState("error");
      }
    })();
    checkInFlightRef.current = work;
    try { await work; } finally { checkInFlightRef.current = null; }
  }, [getRegistration, state]);

  useEffect(() => {
    installPikiReleaseHeaders();
    // oxlint-disable-next-line react/set-state-in-effect
    void check("initial");
    const onFocus = () => void check("focus");
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void check("visible");
    };
    const unsubscribeSafety = subscribePwaOperationSafety((safety) => {
      safetyRef.current = safety;
      if (!shouldDeferPwaActivation(safety)) {
        if (controllerChangedRef.current) void navigateToTarget(targetRef.current, true);
        else if (state === "required") setState("required");
      }
    });
    const onControllerChange = () => {
      if (!activationRequestedRef.current) return;
      controllerChangedRef.current = true;
      void navigateToTarget(targetRef.current, true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);
    const timer = window.setInterval(() => void check("interval"), 5 * 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
      unsubscribeSafety();
      window.clearInterval(timer);
    };
  }, [check, navigateToTarget, state]);

  const update = useCallback(async () => {
    if (nativeApp || updating) return;
    setUpdating(true);
    setDetail("");
    try {
      if (shouldDeferPwaActivation(safetyRef.current)) {
        setUpdating(false);
        setDetail("Terminaremos la actualización cuando acabes la entrega, el cobro o el formulario en curso.");
        return;
      }
      const target = targetRef.current;
      if (!target) {
        setUpdating(false);
        setDetail("No se ha confirmado una nueva versión web para esta superficie.");
        return;
      }
      const registration = await getRegistration();
      if (!registration) {
        setUpdating(false);
        setDetail("No se pudo iniciar el servicio de actualización. Comprueba tu conexión y vuelve a intentarlo.");
        return;
      }
      await Promise.race([registration.update().catch(() => undefined), new Promise<void>((resolve) => window.setTimeout(resolve, workerActivationTimeoutMs))]);
      const waiting = await waitForPikiWaitingWorker(registration, workerActivationTimeoutMs);
      if (!waiting) {
        if (!navigateToTarget(target, true)) setUpdating(false);
        return;
      }
      activationRequestedRef.current = true;
      const previousController = navigator.serviceWorker.controller;
      const controllerChanged = waitForPikiControllerChange(navigator.serviceWorker, previousController, workerActivationTimeoutMs);
      waiting.postMessage({ type: "SKIP_WAITING" });
      if (await controllerChanged) navigateToTarget(target, true);
      else if (!navigateToTarget(target, true)) setUpdating(false);
    } catch (error) {
      setUpdating(false);
      setDetail(error instanceof Error ? error.message : "No se pudo descargar la actualización.");
    }
  }, [getRegistration, navigateToTarget, updating]);

  if (state === "checking") return <main aria-live="polite" style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui", padding: "24px" }}>Comprobando la versión segura de PIKI…</main>;
  if (state === "required") return <main aria-labelledby="piki-update-title" style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui", padding: "24px", background: "#f8fafc" }}><section role="dialog" aria-modal="true" style={{ maxWidth: "480px", padding: "28px", background: "white", borderRadius: "16px", boxShadow: "0 12px 40px rgba(15,23,42,.15)" }}><p style={{ fontWeight: 700, color: "#b45309" }}>PIKI RIDERS · ACTUALIZACIÓN {nativeSecurityUpdate ? "DE APLICACIÓN" : "PWA"}</p><h1 id="piki-update-title">{nativeSecurityUpdate ? "Actualiza la aplicación para continuar" : "Hay una nueva versión lista"}</h1><p>{nativeSecurityUpdate ? `Esta aplicación necesita la versión firmada ${requiredVersion}. Instálala desde el canal firmado autorizado por PIKI o Google Play si es el canal configurado; los recursos embebidos no se actualizan desde una PWA.` : `El nuevo build web ${requiredVersion} se aplicará sin cerrar tu sesión ni borrar los datos guardados.`}</p>{detail && <p role="alert">{detail}</p>}{!nativeSecurityUpdate && <button type="button" onClick={() => void update()} disabled={updating} style={{ padding: "12px 16px", border: 0, borderRadius: "9px", background: "#111827", color: "white", fontWeight: 700 }}>{updating ? "Aplicando nuevo build…" : "Actualizar PWA"}</button>}</section></main>;
  return <>{state === "error" && <div role="status" style={{ position: "fixed", zIndex: 9998, top: 0, left: 0, right: 0, padding: "8px", textAlign: "center", background: "#fef3c7", color: "#78350f", fontSize: "13px" }}>Conexión de seguridad temporalmente no disponible. Puedes iniciar sesión; lo volveremos a comprobar automáticamente.</div>}{availableBuild && <div role="status" style={{ position: "fixed", zIndex: 9997, top: 0, left: 0, right: 0, padding: "8px", textAlign: "center", background: "#e0f2fe", color: "#0c4a6e", fontSize: "13px" }}>Nueva versión de PWA disponible: {availableBuild}. <button type="button" onClick={() => void update()} disabled={updating} style={{ marginLeft: "8px", border: 0, borderRadius: "6px", padding: "4px 8px", fontWeight: 700 }}>{updating ? "Preparando…" : "Actualizar PWA"}</button></div>}{children}<PushConsentControl /></>;
}
