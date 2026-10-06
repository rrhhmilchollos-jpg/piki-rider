import { Eye, EyeOff, LockKeyhole, Mail, Navigation, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { getStoredEmail, storeEmail } from "./authStorage";
import { buildRiderEmployeeLoginPayload } from "./employeeLogin";
import "./RiderAccess.css";
import { playPikiUiSound } from "./uiSounds";

type Props = { apiOrigin: string; onAuthenticated: (token: string) => void };

export default function EmployeeAuthGate({ apiOrigin, onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "change">("login");
  const [token, setToken] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(() => getStoredEmail());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "login") {
        const normalizedEmail = email.trim().toLowerCase();
        const response = await fetch(`${apiOrigin}/api/v1/auth/employee/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify(buildRiderEmployeeLoginPayload(normalizedEmail, currentPassword)) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || "No se pudo iniciar sesión");
        storeEmail(normalizedEmail); setToken(data.accessToken);
        if (data.requiresPasswordChange) setMode("change"); else {
          playPikiUiSound("/sounds/rider-login.mp3");
          onAuthenticated(data.accessToken);
        }
      } else {
        const response = await fetch(`${apiOrigin}/api/v1/auth/employee/change-password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-PIKI-Surface": "rider" }, body: JSON.stringify({ currentPassword, newPassword: password }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || "No se pudo cambiar la contraseña");
        playPikiUiSound("/sounds/rider-login.mp3");
        onAuthenticated(token);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo completar el acceso"); }
    finally { setBusy(false); }
  }

  const passwordLabel = mode === "login" ? "Contraseña" : "Contraseña temporal actual";
  return <main className="rider-access-shell">
    <section className="rider-access-visual" aria-hidden="true">
      <div className="rider-access-orbit orbit-one"/><div className="rider-access-orbit orbit-two"/>
      <div className="rider-access-mark"><Navigation size={30}/></div>
      <p>PIKI RIDER · RED OPERATIVA</p><h1>Tu ciudad.<br/>Tu ruta.<br/><em>Tu ritmo.</em></h1>
      <span>Las decisiones llegan claras. El movimiento queda en tus manos.</span>
    </section>
    <form className="rider-access-card" onSubmit={submit} autoComplete="on">
      <div className="rider-access-badge"><ShieldCheck size={15}/> Acceso protegido</div>
      <h2>{mode === "login" ? "Entra en jornada" : "Asegura tu cuenta"}</h2>
      <p>{mode === "login" ? "Identifícate para ver tus rutas, pedidos y horario de hoy." : "Crea una contraseña permanente antes de operar."}</p>
      {mode === "login" && <label><span><Mail size={15}/> Correo de rider</span><input type="email" name="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu-correo@empresa.com" autoComplete="username" required /></label>}
      <label><span><LockKeyhole size={15}/> {passwordLabel}</span><div className="rider-password-field"><input type={showPassword ? "text" : "password"} name={mode === "login" ? "password" : "current-password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="••••••••••••" autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
      {mode === "change" && <label><span><LockKeyhole size={15}/> Nueva contraseña</span><input type={showPassword ? "text" : "password"} name="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 12 caracteres" autoComplete="new-password" minLength={12} required /></label>}
      {error && <p className="rider-access-error" role="alert">{error}</p>}
      <button className="rider-access-submit" type="submit" disabled={busy}>{busy ? "Comprobando acceso…" : mode === "login" ? "Continuar a mi jornada" : "Guardar y continuar"}<Navigation size={18}/></button>
      <small>Tu sesión se protege en este dispositivo. Nunca compartas tu contraseña por mensajes.</small>
    </form>
  </main>;
}
