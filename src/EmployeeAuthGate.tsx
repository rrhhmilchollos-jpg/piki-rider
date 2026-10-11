import { Eye, EyeOff, KeyRound, LockKeyhole, Mail, Navigation, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { getStoredEmail, storeEmail } from "./authStorage";
import { buildRiderEmployeeLoginPayload } from "./employeeLogin";
import "./RiderAccess.css";
import { playPikiUiSound } from "./uiSounds";

type Props = { apiOrigin: string; onAuthenticated: (token: string) => void };
type AuthMode = "login" | "change" | "request" | "reset";

export default function EmployeeAuthGate({ apiOrigin, onAuthenticated }: Props) {
  const [mode, setMode] = useState<AuthMode>(() => new URLSearchParams(window.location.search).has("reset") ? "reset" : "login");
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get("reset") || "");
  const [token, setToken] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(() => getStoredEmail());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function switchMode(next: AuthMode) { setMode(next); setError(""); setMessage(""); setCurrentPassword(""); setPassword(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "request") {
        const response = await fetch(`${apiOrigin}/api/v1/auth/employee/password-reset/request`, { method: "POST", headers: { "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ email }) });
        const data = await response.json().catch(() => ({})) as { message?: string };
        if (!response.ok) throw new Error(data.message || "No se ha podido solicitar la recuperación."); setMessage(data.message || "Si el correo es válido, recibirás un enlace de recuperación."); return;
      }
      if (mode === "reset") {
        const response = await fetch(`${apiOrigin}/api/v1/auth/employee/password-reset/confirm`, { method: "POST", headers: { "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ token: resetToken, newPassword: password }) });
        const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
        if (!response.ok) throw new Error(data.message || data.error || "No se ha podido crear la contraseña."); window.history.replaceState({}, "", window.location.pathname); switchMode("login"); setMessage("Contraseña actualizada. Ya puedes iniciar sesión."); return;
      }
      if (mode === "login") {
        const normalizedEmail = email.trim().toLowerCase();
        const response = await fetch(`${apiOrigin}/api/v1/auth/employee/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify(buildRiderEmployeeLoginPayload(normalizedEmail, currentPassword)) });
        const data = await response.json(); if (!response.ok) throw new Error(data.message || data.error || "No se pudo iniciar sesión"); storeEmail(normalizedEmail); setToken(data.accessToken); if (data.requiresPasswordChange) setMode("change"); else { playPikiUiSound("/sounds/piki-alert-15s.mp3"); onAuthenticated(data.accessToken); } return;
      }
      const response = await fetch(`${apiOrigin}/api/v1/auth/employee/change-password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-PIKI-Surface": "rider" }, body: JSON.stringify({ currentPassword, newPassword: password }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || data.error || "No se pudo cambiar la contraseña"); playPikiUiSound("/sounds/piki-alert-15s.mp3"); onAuthenticated(token);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo completar el acceso"); } finally { setBusy(false); }
  }
  const resetFlow = mode === "reset" || mode === "request";
  return <main className="rider-access-shell"><section className="rider-access-visual" aria-hidden="true"><div className="rider-access-orbit orbit-one"/><div className="rider-access-orbit orbit-two"/><div className="rider-access-mark">{resetFlow ? <KeyRound size={30}/> : <Navigation size={30}/>}</div><p>PIKI RIDER · RED OPERATIVA</p><h1>Tu ciudad.<br/>Tu ruta.<br/><em>Tu ritmo.</em></h1><span>Tu acceso es individual y solo muestra tu jornada, rutas y pedidos asignados.</span></section><form className="rider-access-card" onSubmit={submit} autoComplete="on"><div className="rider-access-badge"><ShieldCheck size={15}/> Acceso protegido</div><h2>{mode === "login" ? "Entra en jornada" : mode === "request" ? "Recupera tu acceso" : mode === "reset" ? "Crea una contraseña nueva" : "Asegura tu cuenta"}</h2><p>{mode === "login" ? "Identifícate para ver tus rutas, pedidos y horario de hoy." : mode === "request" ? "Te enviaremos un enlace de un solo uso a tu correo Rider." : mode === "reset" ? "El enlace es personal y caduca. Define una contraseña segura para continuar." : "Crea una contraseña permanente antes de operar."}</p>{(mode === "login" || mode === "request") && <label><span><Mail size={15}/> Correo de Rider</span><input type="email" name="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu-correo@empresa.com" autoComplete="username" required /></label>}{(mode === "login" || mode === "change") && <label><span><LockKeyhole size={15}/> {mode === "login" ? "Contraseña" : "Contraseña temporal actual"}</span><div className="rider-password-field"><input type={showPassword ? "text" : "password"} name={mode === "login" ? "password" : "current-password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="••••••••••••" autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>}{(mode === "change" || mode === "reset") && <label><span><LockKeyhole size={15}/> Nueva contraseña</span><input type={showPassword ? "text" : "password"} name="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="12 caracteres, mayúscula, minúscula y número" autoComplete="new-password" minLength={12} required /></label>}{error && <p className="rider-access-error" role="alert">{error}</p>}{message && <p className="rider-access-success" role="status">{message}</p>}<button className="rider-access-submit" type="submit" disabled={busy}>{busy ? "Procesando acceso…" : mode === "login" ? "Continuar a mi jornada" : mode === "request" ? "Enviar enlace seguro" : "Guardar y continuar"}<Navigation size={18}/></button>{mode === "login" && <button className="rider-access-link" type="button" onClick={() => switchMode("request")}>He olvidado mi contraseña</button>}{(mode === "request" || mode === "reset") && <button className="rider-access-link" type="button" onClick={() => switchMode("login")}>Volver al inicio de sesión</button>}<small>Tu sesión se protege en este dispositivo. Nunca compartas tu contraseña por mensajes.</small></form></main>;
}
