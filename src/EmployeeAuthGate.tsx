import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { getRememberDevice, getStoredEmail, storeEmail } from "./authStorage";
import "./EmployeeAuthGate.css";

type Props = { apiOrigin: string; onAuthenticated: (token: string, rememberDevice: boolean) => void };
type AuthResponse = { accessToken: string; requiresPasswordChange?: boolean; message?: string; error?: string };
const recoveryEmail = "rrhh.milchollos@gmail.com";

export default function EmployeeAuthGate({ apiOrigin, onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "change">("login");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState(() => getStoredEmail());
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(() => getRememberDevice());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recoveryHref = `mailto:${recoveryEmail}?subject=${encodeURIComponent("Restablecer acceso a PIKI Rider")}&body=${encodeURIComponent(`Solicito ayuda para restablecer mi acceso a PIKI Rider.\nCorreo de empleado: ${email.trim() || "(escribe aquí tu correo corporativo)"}`)}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "login") {
        const normalizedEmail = email.trim().toLowerCase();
        const response = await fetch(`${apiOrigin}/api/v1/auth/employee/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ email: normalizedEmail, password: currentPassword }) });
        const data = await response.json() as AuthResponse;
        if (!response.ok) throw new Error(data.message || data.error || "No se pudo iniciar sesión");
        storeEmail(normalizedEmail, rememberDevice);
        setToken(data.accessToken);
        if (data.requiresPasswordChange) setMode("change"); else onAuthenticated(data.accessToken, rememberDevice);
      } else {
        const response = await fetch(`${apiOrigin}/api/v1/auth/employee/change-password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ currentPassword, newPassword }) });
        const data = await response.json() as AuthResponse;
        if (!response.ok) throw new Error(data.message || data.error || "No se pudo cambiar la contraseña");
        onAuthenticated(token, rememberDevice);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo completar el acceso"); }
    finally { setBusy(false); }
  }

  return <form className="token-card employee-auth-card" onSubmit={submit} autoComplete="on">
    <strong>{mode === "login" ? "Acceso de empleados PIKI" : "Cambia tu contraseña temporal"}</strong>
    <span>{mode === "login" ? "Usa el correo corporativo y la contraseña entregada por Administración." : "Debes definir una contraseña permanente antes de acceder a cualquier herramienta."}</span>
    {mode === "login" && <input type="email" name="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo@pikidelivery.com" autoComplete="username" required />}
    <div className="employee-password-field">
      <input type={showCurrentPassword ? "text" : "password"} name={mode === "login" ? "password" : "current-password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={mode === "login" ? "Contraseña" : "Contraseña temporal actual"} autoComplete="current-password" required />
      <button className="employee-password-toggle" type="button" aria-label={showCurrentPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showCurrentPassword} onClick={() => setShowCurrentPassword((visible) => !visible)}><span className="sr-only">{showCurrentPassword ? "Ocultar contraseña" : "Mostrar contraseña"}</span>{showCurrentPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button>
    </div>
    {mode === "change" && <div className="employee-password-field">
      <input type={showNewPassword ? "text" : "password"} name="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nueva contraseña (12+ caracteres)" autoComplete="new-password" minLength={12} required />
      <button className="employee-password-toggle" type="button" aria-label={showNewPassword ? "Ocultar contraseña nueva" : "Mostrar contraseña nueva"} aria-pressed={showNewPassword} onClick={() => setShowNewPassword((visible) => !visible)}><span className="sr-only">{showNewPassword ? "Ocultar contraseña nueva" : "Mostrar contraseña nueva"}</span>{showNewPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button>
    </div>}
    {mode === "login" && <>
      <label className="employee-remember-row"><input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} />Recordar correo y sesión segura en este dispositivo</label>
      <small className="employee-security-note">Si marcas «Recordar», la sesión se conserva en este navegador hasta que expire (máximo 7 días) o cierres sesión. Si no, dura solo la sesión actual. PIKI no guarda la contraseña; puedes usar el gestor del navegador.</small>
      <a className="employee-forgot-link" href={recoveryHref}>¿Has olvidado tu contraseña?</a>
      <small className="employee-recovery-note">Si no se abre el correo, escribe a rrhh.milchollos@gmail.com. RRHH verificará la cuenta y emitirá una clave temporal.</small>
    </>}
    {error && <small className="form-error">{error}</small>}
    <button type="submit" disabled={busy}>{busy ? "Validando…" : mode === "login" ? "Iniciar sesión" : "Guardar contraseña definitiva"}</button>
  </form>;
}
