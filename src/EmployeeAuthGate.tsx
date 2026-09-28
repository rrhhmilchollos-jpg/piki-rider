import { useState, type FormEvent } from "react";
import { getStoredEmail, storeEmail } from "./authStorage";

type Props = { apiOrigin: string; onAuthenticated: (token: string) => void };

export default function EmployeeAuthGate({ apiOrigin, onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "change">("login");
  const [token, setToken] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(() => getStoredEmail());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "login") {
        const normalizedEmail = email.trim().toLowerCase();
        const response = await fetch(`${apiOrigin}/api/v1/auth/employee/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ email: normalizedEmail, password: currentPassword }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || "No se pudo iniciar sesión");
        storeEmail(normalizedEmail); setToken(data.accessToken);
        if (data.requiresPasswordChange) setMode("change"); else onAuthenticated(data.accessToken);
      } else {
        const response = await fetch(`${apiOrigin}/api/v1/auth/employee/change-password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ currentPassword, newPassword: password }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || "No se pudo cambiar la contraseña");
        onAuthenticated(token);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo completar el acceso"); }
    finally { setBusy(false); }
  }

  return <form className="token-card employee-auth-card" onSubmit={submit} autoComplete="on">
    <strong>{mode === "login" ? "Acceso de empleados PIKI" : "Cambia tu contraseña temporal"}</strong>
    <span>{mode === "login" ? "Usa el correo corporativo y la contraseña entregada por Administración." : "Debes definir una contraseña permanente antes de acceder a cualquier herramienta."}</span>
    {mode === "login" && <input type="email" name="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo@pikidelivery.com" autoComplete="username" required />}
    <input type="password" name={mode === "login" ? "password" : "current-password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={mode === "login" ? "Contraseña" : "Contraseña temporal actual"} autoComplete="current-password" required />
    {mode === "change" && <input type="password" name="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nueva contraseña (12+ caracteres)" autoComplete="new-password" minLength={12} required />}
    {error && <small className="form-error">{error}</small>}
    {mode === "login" && <small>El correo se recordará en este dispositivo. La contraseña la gestiona el navegador o el gestor de contraseñas del móvil.</small>}
    <button type="submit" disabled={busy}>{busy ? "Validando…" : mode === "login" ? "Iniciar sesión" : "Guardar contraseña definitiva"}</button>
  </form>;
}
