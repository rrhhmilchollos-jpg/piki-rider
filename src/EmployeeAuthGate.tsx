import { Eye, EyeOff, KeyRound, LockKeyhole, Mail, Navigation, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { forgetEmail, getStoredEmail, storeEmail } from "./authStorage";
import { buildRiderEmployeeLoginPayload } from "./employeeLogin";
import "./RiderAccess.css";

type Props = { apiOrigin: string; onAuthenticated: (token: string) => void; onBusyChange?: (busy: boolean) => void };
type AuthMode = "login" | "change" | "request" | "reset";

const NETWORK_ERROR_MESSAGE = "No hay conexión con PIKI ahora mismo. Comprueba tus datos móviles o Wi‑Fi y vuelve a intentarlo.";

async function requestAuth(
  url: string,
  init: RequestInit,
  options: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise<void>((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
    } finally {
      window.clearTimeout(timeout);
    }
  }
  if (lastError instanceof DOMException && lastError.name === "AbortError") throw new Error(NETWORK_ERROR_MESSAGE);
  throw new Error(NETWORK_ERROR_MESSAGE);
}

async function readAuthBody(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
}

function authErrorMessage(response: Response, body: Record<string, unknown>, fallback: string): string {
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After")?.trim() || "";
    const headerSeconds = /^\d+(?:\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1_000;
    const seconds = Number.isFinite(headerSeconds) && headerSeconds > 0
      ? headerSeconds : body.retryAfterSeconds;
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
      ? `Demasiados intentos. Vuelve a intentarlo en ${Math.ceil(seconds)} segundos.`
      : "Demasiados intentos. Espera un momento antes de volver a intentarlo.";
  }
  return typeof body.message === "string" && body.message.trim() ? body.message
    : typeof body.error === "string" && body.error.trim() ? body.error : fallback;
}

export default function EmployeeAuthGate({ apiOrigin, onAuthenticated, onBusyChange }: Props) {
  const [mode, setMode] = useState<AuthMode>(() => new URLSearchParams(window.location.search).has("reset") ? "reset" : "login");
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get("reset") || "");
  const [token, setToken] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(() => getStoredEmail());
  const [rememberEmail, setRememberEmail] = useState(() => getStoredEmail().length > 0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  const onBusyChangeRef = useRef(onBusyChange);

  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  }, [onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submittingRef.current = false;
      onBusyChangeRef.current?.(false);
    };
  }, []);

  function switchMode(next: AuthMode) { setMode(next); setError(""); setMessage(""); setCurrentPassword(""); setPassword(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || !mountedRef.current) return;
    submittingRef.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      // Notify before the first await: App's update guard must observe the
      // transaction even before React commits the local busy render.
      onBusyChangeRef.current?.(true);
      if (mode === "request") {
        const response = await requestAuth(`${apiOrigin}/api/v1/auth/employee/password-reset/request`, { method: "POST", headers: { "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ email: email.trim().toLowerCase() }) });
        const data = await readAuthBody(response);
        if (!mountedRef.current) return;
        if (!response.ok) throw new Error(authErrorMessage(response, data, "No se ha podido solicitar la recuperación."));
        setMessage(typeof data.message === "string" && data.message.trim() ? data.message : "Si el correo es válido, recibirás un enlace de recuperación.");
        return;
      }
      if (mode === "reset") {
        const response = await requestAuth(`${apiOrigin}/api/v1/auth/employee/password-reset/confirm`, { method: "POST", headers: { "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ token: resetToken, newPassword: password }) }, { retries: 0 });
        const data = await readAuthBody(response);
        if (!mountedRef.current) return;
        if (!response.ok) throw new Error(authErrorMessage(response, data, "No se ha podido crear la contraseña."));
        window.history.replaceState({}, "", window.location.pathname); switchMode("login"); setMessage("Contraseña actualizada. Ya puedes iniciar sesión."); return;
      }
      if (mode === "login") {
        const normalizedIdentifier = email.trim().toLowerCase();
        const response = await requestAuth(`${apiOrigin}/api/v1/auth/employee/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify(buildRiderEmployeeLoginPayload(normalizedIdentifier, currentPassword)) });
        const data = await readAuthBody(response);
        if (!mountedRef.current) return;
        if (!response.ok) throw new Error(authErrorMessage(response, data, "No se pudo iniciar sesión"));
        const accessToken = typeof data.accessToken === "string" ? data.accessToken.trim() : "";
        if (!accessToken || (Object.prototype.hasOwnProperty.call(data, "requiresPasswordChange") && typeof data.requiresPasswordChange !== "boolean")) {
          throw new Error("La API no confirmó un acceso válido. Vuelve a iniciar sesión.");
        }
        // Validate the entire login contract before remembering identity,
        // entering password change or forwarding a token to App.
        if (rememberEmail && normalizedIdentifier.includes("@")) storeEmail(normalizedIdentifier); else if (!rememberEmail) forgetEmail();
        setToken(accessToken);
        if (data.requiresPasswordChange === true) setMode("change"); else onAuthenticated(accessToken);
        return;
      }
      if (!token.trim()) throw new Error("La API no confirmó un acceso válido. Vuelve a iniciar sesión.");
      const response = await requestAuth(`${apiOrigin}/api/v1/auth/employee/change-password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-PIKI-Surface": "rider" }, body: JSON.stringify({ currentPassword, newPassword: password }) });
      const data = await readAuthBody(response);
      if (!mountedRef.current) return;
      if (!response.ok) throw new Error(authErrorMessage(response, data, "No se pudo cambiar la contraseña"));
      onAuthenticated(token);
    } catch (caught) {
      if (!mountedRef.current) return;
      const message = caught instanceof Error ? caught.message : "No se pudo completar el acceso.";
      setError(message === "Failed to fetch" || message === "Load failed" ? NETWORK_ERROR_MESSAGE : message);
    } finally {
      submittingRef.current = false;
      // Cleanup already released the old owner's guard on unmount. A late
      // response must not clear a new gate's transaction or authenticate it.
      if (mountedRef.current) {
        setBusy(false);
        onBusyChangeRef.current?.(false);
      }
    }
  }
  const resetFlow = mode === "reset" || mode === "request";
  return <main className="rider-access-shell"><section className="rider-access-visual" aria-hidden="true"><div className="rider-access-orbit orbit-one"/><div className="rider-access-orbit orbit-two"/><div className="rider-access-mark">{resetFlow ? <KeyRound size={30}/> : <Navigation size={30}/>}</div><p>PIKI RIDER · RED OPERATIVA</p><h1>Tu ciudad.<br/>Tu ruta.<br/><em>Tu ritmo.</em></h1><span>Tu acceso es individual y solo muestra tu jornada, rutas y pedidos asignados.</span></section><form className="rider-access-card" onSubmit={submit} autoComplete="on"><div className="rider-access-badge"><ShieldCheck size={15}/> Acceso protegido</div><h2>{mode === "login" ? "Entra en jornada" : mode === "request" ? "Recupera tu acceso" : mode === "reset" ? "Crea una contraseña nueva" : "Asegura tu cuenta"}</h2><p>{mode === "login" ? "Identifícate con tu correo corporativo o ID PIKI para ver tus rutas, pedidos y horario de hoy." : mode === "request" ? "Te enviaremos un enlace de un solo uso a tu correo Rider." : mode === "reset" ? "El enlace es personal y caduca. Define una contraseña segura para continuar." : "Crea una contraseña permanente antes de operar."}</p>{(mode === "login" || mode === "request") && <label><span><Mail size={15}/> {mode === "login" ? "Correo o ID PIKI" : "Correo de Rider"}</span><input type={mode === "login" ? "text" : "email"} name="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={mode === "login" ? "tu-correo@empresa.com o PIKI-E-XXXXXXXX" : "tu-correo@empresa.com"} autoComplete="username" required /></label>}{(mode === "login" || mode === "change") && <label><span><LockKeyhole size={15}/> {mode === "login" ? "Contraseña" : "Contraseña temporal actual"}</span><div className="rider-password-field"><input type={showPassword ? "text" : "password"} name={mode === "login" ? "password" : "current-password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="••••••••••••" autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>}{(mode === "change" || mode === "reset") && <label><span><LockKeyhole size={15}/> Nueva contraseña</span><input type={showPassword ? "text" : "password"} name="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="12 caracteres, mayúscula, minúscula y número" autoComplete="new-password" minLength={12} required /></label>}{error && <p className="rider-access-error" role="alert">{error}</p>}{message && <p className="rider-access-success" role="status">{message}</p>}{mode === "login" && <label style={{display:"flex",alignItems:"center",gap:"8px",margin:"12px 0 0",fontSize:"13px",opacity:0.85}}><input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} style={{width:"16px",height:"16px"}} />Recordarme en este dispositivo</label>}<button className="rider-access-submit" type="submit" disabled={busy}>{busy ? "Procesando acceso…" : mode === "login" ? "Continuar a mi jornada" : mode === "request" ? "Enviar enlace seguro" : "Guardar y continuar"}<Navigation size={18}/></button>{mode === "login" && <button className="rider-access-link" type="button" onClick={() => switchMode("request")}>He olvidado mi contraseña</button>}{(mode === "request" || mode === "reset") && <button className="rider-access-link" type="button" onClick={() => switchMode("login")}>Volver al inicio de sesión</button>}<small>Tu sesión se protege en este dispositivo. Nunca compartas tu contraseña por mensajes.</small></form></main>;
}
