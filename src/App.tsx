import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity, ArrowDownLeft, ArrowUpRight, Bell, Bike, CalendarDays, ChevronRight,
  CircleHelp, ClipboardList, Clock3, CreditCard, FileText, Headphones,
  LayoutDashboard, LifeBuoy, MapPinned, Menu, MessageCircle, Navigation,
  Power, Settings, ShieldCheck, WalletCards, X, Zap
} from "lucide-react";
import "./App.css";
import EmployeeAuthGate from "./EmployeeAuthGate";
import LiveGoogleMap from "./components/LiveGoogleMap";

type Status = "checking" | "ready" | "unavailable";
type ApplicationStatus = "idle" | "sending" | "sent" | "error";
type Shift = { day: string; date: string; start: string; end: string; zone: string; status: "assigned" | "pending" | "planned" | "active" | "completed" | "cancelled" };
type CurrentShift = { eligible: boolean; now?: { date: string; time: string }; shift?: Shift | null };
type Stats = { completed: number; cancelled: number; accepted: number; rating: string; distance: string; dailyDeliveries: Array<{ date: string; completed: number }> };
type RiderOffer = { _id: string; publicCode?: string; assignmentState: "offered" | "assigned"; assignmentExpiresAt?: string | null };

const apiOrigin = (import.meta.env.VITE_API_URL ?? "https://api.pikidelivery.com").replace(/\/$/, "");
const tokenStorageKey = `piki-${location.hostname}-api-token`;
function authHeaders(token: string): Record<string, string> { return token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}; }
const nav = [
  ["Inicio", LayoutDashboard], ["Ofertas", Bell], ["Entregas", ClipboardList], ["Mapa", MapPinned],
  ["Horarios", CalendarDays], ["Cartera", WalletCards], ["Estadísticas", Activity], ["Soporte", LifeBuoy],
  ["Cuenta", Settings],
] as const;
const weekdayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function App() {
  const [section, setSection] = useState("Inicio");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("checking");
  const [authRequired, setAuthRequired] = useState(false);
  const [apiToken, setApiToken] = useState(() => sessionStorage.getItem(tokenStorageKey) || "");
  const [applicationStatus, setApplicationStatus] = useState<ApplicationStatus>("idle");
  const [error, setError] = useState("");
  const [shiftActive, setShiftActive] = useState(false);
  const [riderId, setRiderId] = useState("");
  const [currentShift, setCurrentShift] = useState<CurrentShift>({ eligible: false });
  const [toast, setToast] = useState("");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [stats, setStats] = useState<Stats>({ completed: 0, cancelled: 0, accepted: 0, rating: "—", distance: "—", dailyDeliveries: [] });
  const knownOfferIdsRef = useRef<Set<string> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  function playAssignmentAlert() {
    try {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const audio = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = audio;
      void audio.resume();
      const now = audio.currentTime;
      [0, 0.18, 0.36].forEach((offset, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index === 1 ? 1046 : 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.start(now + offset); oscillator.stop(now + offset + 0.16);
      });
      if ("vibrate" in navigator) navigator.vibrate([180, 80, 180]);
    } catch { /* The device may block audio until the next user gesture. */ }
  }

  const loadRiderData = useCallback(async () => {
    if (!apiToken) return;
    const headers = authHeaders(apiToken);
    try {
      const sessionResponse = await fetch(`${apiOrigin}/api/v1/riders/session`, { headers });
      if (!sessionResponse.ok) return;
      const sessionData = await sessionResponse.json() as { rider?: { id?: string; status?: string } };
      const id = String(sessionData.rider?.id || "");
      if (!id) return;
      setRiderId(id);
      const [slotResponse, statsResponse, shiftResponse] = await Promise.all([
        fetch(`${apiOrigin}/api/v1/riders/${id}/slots`, { headers }),
        fetch(`${apiOrigin}/api/v1/riders/statistics`, { headers }),
        fetch(`${apiOrigin}/api/v1/riders/${id}/shift`, { headers }),
      ]);
      if (slotResponse.ok) {
        const data = await slotResponse.json() as { slots?: Shift[] };
        setShifts(Array.isArray(data.slots) ? data.slots : []);
      }
      if (shiftResponse.ok) {
        const data = await shiftResponse.json() as CurrentShift;
        setCurrentShift(data);
        setShiftActive(data.shift?.status === "active");
      }
      if (statsResponse.ok) {
        const data = await statsResponse.json() as { statistics?: Partial<Stats> };
        setStats(prev => ({ ...prev, ...(data.statistics ?? {}) }));
      }
    } catch { /* Panels remain usable while the API is unavailable. */ }
  }, [apiToken]);

  useEffect(() => { const timer = window.setTimeout(() => { void loadRiderData(); }, 0); return () => window.clearTimeout(timer); }, [loadRiderData]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3500); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!apiToken || !riderId || !shiftActive) { knownOfferIdsRef.current = null; return; }
    let disposed = false;
    const pollOffers = async () => {
      try {
        const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/offers`, { headers: authHeaders(apiToken) });
        if (!response.ok || disposed) return;
        const data = await response.json() as { offers?: RiderOffer[] };
        const offers = Array.isArray(data.offers) ? data.offers : [];
        const currentIds = new Set(offers.map(offer => String(offer._id)));
        if (knownOfferIdsRef.current === null) { knownOfferIdsRef.current = currentIds; return; }
        const hasNewOffer = offers.some(offer => !knownOfferIdsRef.current?.has(String(offer._id)));
        knownOfferIdsRef.current = currentIds;
        if (hasNewOffer) { playAssignmentAlert(); setToast("Nuevo reparto asignado. Revisa tus ofertas."); }
      } catch { /* Keep the rider operational if a polling request is briefly unavailable. */ }
    };
    void pollOffers();
    const timer = window.setInterval(() => { void pollOffers(); }, 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [apiToken, riderId, shiftActive]);

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setApplicationStatus("sending"); setError("");
    const form = new FormData(event.currentTarget);
    const body = { name: String(form.get("name") || ""), email: String(form.get("email") || ""), phone: String(form.get("phone") || ""), city: String(form.get("city") || "Xàtiva"), vehicle: String(form.get("vehicle") || "electric_scooter"), availability: String(form.get("availability") || ""), website: String(form.get("website") || "") };
    try {
      const response = await fetch(`${apiOrigin}/api/v1/riders/applications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo enviar la solicitud");
      setApplicationStatus("sent"); event.currentTarget.reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo enviar la solicitud"); setApplicationStatus("error"); }
  }

    const activeShifts = useMemo(() => weekdayNames.map((day) => shifts.find(shift => shift.day === day) ?? { day, date: "", start: "", end: "", zone: "", status: "pending" as const }), [shifts]);
  const showApplication = section === "Solicitar alta";

  function showSection(next: string) { setSection(next); setOpen(false); }
  async function toggleShift() {
    if (!riderId) { setToast("No hay una cuenta Rider vinculada a esta sesión."); return; }
    const endpoint = shiftActive ? "stop" : "start";
    try {
      const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/shift/${endpoint}`, { method: "POST", headers: authHeaders(apiToken) });
      const data = await response.json() as { message?: string; error?: string; shift?: Shift; now?: { date: string; time: string } };
      if (!response.ok) {
        setToast(data.message || "No puedes iniciar: no hay un turno reservado activo.");
        return;
      }
      setShiftActive(!shiftActive);
      setCurrentShift(previous => ({ ...previous, eligible: !shiftActive, shift: data.shift ?? previous.shift }));
      if (!shiftActive && typeof window !== "undefined") {
        const audio = new AudioContext();
        const oscillator = audio.createOscillator(); const gain = audio.createGain();
        oscillator.frequency.value = 880; gain.gain.value = 0.12; oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.start(); oscillator.stop(audio.currentTime + 0.45);
      }
      setToast(shiftActive ? "Jornada finalizada. Buen trabajo." : "Jornada iniciada. Aviso sonoro activado.");
    } catch { setToast("No se pudo validar el turno con la API."); }
  }
  function supportAction(label: string) { setToast(`${label}: el equipo de soporte recibirá tu solicitud.`); }

  if (!apiToken || authRequired) return <main className="page-content"><EmployeeAuthGate apiOrigin={apiOrigin} onAuthenticated={(token)=>{sessionStorage.setItem(tokenStorageKey,token);setApiToken(token);setAuthRequired(false);setStatus("checking")}} /></main>;
  if (shiftActive) return <ActiveShiftView token={apiToken} riderId={riderId} onMenu={() => setOpen(true)} onSupport={() => showSection("Soporte")} onStop={toggleShift} toast={toast} onError={setToast} />;
  return <div className="app-shell">
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="brand-block"><div className="brand-mark">P</div><div><strong>piki</strong><span>Riders</span></div><button className="close-menu" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X size={20}/></button></div>
      <nav className="nav-list"><p className="nav-label">TU JORNADA</p>{nav.map(([label, Icon]) => <button key={label} className={`nav-item ${section === label ? "nav-item-active" : ""}`} onClick={() => showSection(label)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-footer"><div className="support-dot"/><div><strong>Red PIKI</strong><span>{status === "ready" ? "Conectada" : "Comprobando"}</span></div><ChevronRight size={16}/></div>
    </aside>
    {open && <button className="backdrop" onClick={() => setOpen(false)} aria-label="Cerrar navegación"/>}
    <main className="main-content">
      <header className="topbar"><button className="menu-button" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu size={21}/></button><div className="location-pill"><Bike size={16}/><span>Operativa de reparto</span><span className="status-dot"/></div><div className="topbar-actions"><button className="icon-button" onClick={() => showSection("Soporte")} aria-label="Abrir soporte"><Headphones size={19}/></button><div className="user-avatar">R</div></div></header>
      <section className="page-content">
        {toast && <div className="toast" role="status"><ShieldCheck size={17}/>{toast}</div>}
        {authRequired && <EmployeeAuthGate apiOrigin={apiOrigin} onAuthenticated={(token)=>{sessionStorage.setItem(tokenStorageKey,token);setApiToken(token);setAuthRequired(false);setStatus("checking")}} />}
        {showApplication ? <section className="application-layout"><div className="page-heading"><div><p className="eyebrow">PIKI · FLEET</p><h1>Únete a la red de riders.</h1><p className="lead">Solicita tu alta en PIKI. El equipo Fleet revisará tus datos, vehículo y disponibilidad antes de activar tu cuenta.</p></div></div><div className="onboarding-grid"><article className="process-card"><span className="step-number">01</span><h2>Cómo funciona</h2><p>Envía tus datos y te contactaremos para validar documentación, zona y disponibilidad.</p><div className="process-line"/><span className="step-number muted-step">02</span><h2>Revisión Fleet</h2><p>Un responsable de zona revisa tu solicitud y agenda la activación.</p><div className="process-line"/><span className="step-number muted-step">03</span><h2>Primer turno</h2><p>Tras la aprobación, recibirás acceso a ofertas y podrás conectarte en tu zona.</p></article><form className="partner-form" onSubmit={submitApplication}><label>Nombre y apellidos<input name="name" required minLength={2} placeholder="Ej. Marta García"/></label><label>Email<input name="email" type="email" required placeholder="marta@email.com"/></label><label>Teléfono<input name="phone" required minLength={6} placeholder="600 000 000"/></label><label>Ciudad de reparto<input name="city" required defaultValue="Xàtiva"/></label><label>Vehículo<select name="vehicle" defaultValue="electric_scooter"><option value="bike">Bicicleta normal</option><option value="electric_bike">Bicicleta eléctrica</option><option value="electric_scooter">Patinete eléctrico</option><option value="motorcycle">Moto</option><option value="car">Coche</option></select></label><label>Disponibilidad<input name="availability" required placeholder="Tardes y fines de semana"/></label><input name="website" className="honeypot" tabIndex={-1} autoComplete="off" aria-hidden="true"/><p className="form-hint">Nunca compartiremos tus datos fuera del proceso de selección de PIKI.</p>{applicationStatus === "error" && <p className="form-error">{error}</p>}{applicationStatus === "sent" && <p className="form-success">Solicitud recibida. El equipo Fleet se pondrá en contacto contigo.</p>}<button className="primary-button form-submit" disabled={applicationStatus === "sending"}>{applicationStatus === "sending" ? "Enviando…" : "Enviar solicitud"}<ChevronRight size={17}/></button></form></div></section> : <>
          {section === "Horarios" && <section className="feature-section"><FeatureHeading eyebrow="PIKI · HORARIOS" title="Tus turnos, claros antes de salir." lead="El Fleet de tu zona asigna los turnos. Solo tú puedes consultar tus horas y días disponibles." icon={<CalendarDays/>}/><div className="shift-toolbar"><div><strong>Calendario de jornada</strong><span>Asignaciones recibidas desde Fleet</span></div><span className="zone-chip">Zona Xàtiva</span></div><div className="schedule-grid">{activeShifts.map(shift => <article className={`schedule-day ${shift.status}`} key={shift.day}><span>{shift.day}</span><strong>{shift.date || "Sin fecha"}</strong>{shift.start ? <><b>{shift.start} – {shift.end}</b><small>{shift.zone || "Zona asignada"}</small></> : <small>Sin turno asignado</small>}</article>)}</div><div className="shift-action"><Clock3 size={20}/><div><strong>{shiftActive ? "Jornada activa" : "Jornada cerrada"}</strong><span>{shiftActive ? "Puedes recibir ofertas en tu zona." : currentShift.eligible ? "Tu turno está abierto: puedes iniciar ahora." : "El botón se activa únicamente durante tu turno reservado."}</span></div><button className="primary-button" disabled={!shiftActive && !currentShift.eligible} onClick={toggleShift}><Power size={16}/>{shiftActive ? "Finalizar jornada" : currentShift.eligible ? "Iniciar jornada" : "Fuera de horario"}</button></div></section>}
          {section === "Cartera" && <section className="feature-section"><FeatureHeading eyebrow="PIKI · CARTERA" title="Tu dinero, siempre bajo control." lead="Consulta ingresos, incentivos, propinas y próximos pagos con trazabilidad." icon={<WalletCards/>}/><div className="wallet-card"><div><span>Saldo disponible</span><strong>€ —</strong><small>Se mostrará cuando existan liquidaciones confirmadas.</small></div><WalletCards size={42}/></div><div className="wallet-grid"><article className="wallet-stat"><ArrowUpRight/><span>Ingresos de entregas</span><strong>€ —</strong></article><article className="wallet-stat"><ArrowDownLeft/><span>Propinas e incentivos</span><strong>€ —</strong></article><article className="wallet-stat"><CreditCard/><span>Próximo pago</span><strong>Pendiente</strong></article></div><div className="empty-card"><div className="empty-card-top"><span>MOVIMIENTOS</span><FileText size={18}/></div><h2>Aún no hay movimientos.</h2><p>Las liquidaciones aparecerán aquí después de completar entregas y superar la validación operativa.</p></div></section>}
          {section === "Estadísticas" && <section className="feature-section"><FeatureHeading eyebrow="PIKI · ESTADÍSTICAS" title="Mejora con cada entrega." lead="Solo tus entregas: aceptadas, completadas, canceladas y calidad." icon={<Activity/>}/><div className="stats-grid"><StatCard label="Completadas" value={stats.completed} tone="positive"/><StatCard label="Canceladas" value={stats.cancelled} tone="negative"/><StatCard label="Aceptadas" value={stats.accepted} tone="neutral"/><StatCard label="Valoración" value={stats.rating} tone="positive"/></div><div className="stats-panel"><div className="stats-panel-head"><div><span>ENTREGAS POR DÍA</span><h2>Tu historial reciente</h2></div><Zap size={22}/></div><div className="daily-deliveries">{stats.dailyDeliveries.length ? stats.dailyDeliveries.map((day) => <div className="daily-delivery-row" key={day.date}><span>{day.date}</span><strong>{day.completed}</strong><small>{day.completed === 1 ? "entrega completada" : "entregas completadas"}</small></div>) : <p className="empty-copy">Todavía no hay entregas registradas.</p>}</div></div></section>}
          {section === "Mapa" && <section className="feature-section"><FeatureHeading eyebrow="PIKI · MAPA OPERATIVO" title="Más demanda, más cerca de ti." lead="Visualiza las zonas activas y los puntos de demanda. El mapa real se alimentará de pedidos y ubicación consentida." icon={<MapPinned/>}/><div className="heatmap"><div className="map-label label-one">Centro · demanda alta</div><div className="map-label label-two">Estación · demanda media</div><div className="map-label label-three">Norte · cobertura</div><div className="heat-point heat-a"/><div className="heat-point heat-b"/><div className="heat-point heat-c"/><div className="heat-point heat-d"/><div className="map-roads road-one"/><div className="map-roads road-two"/><div className="map-controls"><button onClick={() => setToast("Ubicación centrada en tu zona.")}><Navigation size={16}/>Centrar</button><span><i className="legend-high"/> Alta</span><span><i className="legend-mid"/> Media</span></div></div></section>}
          {section === "Soporte" && <section className="feature-section"><FeatureHeading eyebrow="PIKI · SOPORTE" title="Estamos contigo en ruta." lead="Elige la ayuda que necesitas y el equipo de operaciones te responderá." icon={<LifeBuoy/>}/><div className="support-grid"><SupportCard icon={<ClipboardList/>} title="Ayuda con un pedido" text="Retraso, comercio cerrado, dirección o incidencia de entrega." onClick={() => supportAction("Ayuda con un pedido")}/><SupportCard icon={<MessageCircle/>} title="Contacta con soporte" text="Habla con operaciones de zona durante tu jornada." onClick={() => supportAction("Contacto con soporte")}/><SupportCard icon={<ShieldCheck/>} title="Seguridad y emergencias" text="Acceso rápido para incidentes de seguridad en ruta." onClick={() => supportAction("Seguridad y emergencias")}/><SupportCard icon={<CircleHelp/>} title="Preguntas frecuentes" text="Turnos, pagos, asignaciones, sanciones y documentación." onClick={() => supportAction("Preguntas frecuentes")}/></div></section>}
          {!["Horarios", "Cartera", "Estadísticas", "Mapa", "Soporte"].includes(section) && <><div className="page-heading"><div><p className="eyebrow">PIKI · RIDERS</p><h1>{section === "Inicio" ? "Cada entrega, clara desde el primer metro." : section}</h1><p className="lead">Base operativa conectada a producción. Activa tu jornada, consulta horarios y recibe ofertas en tu zona.</p></div><button className="secondary-button" onClick={() => { setStatus("checking"); void loadRiderData(); }}><Activity size={17} className={status === "checking" ? "spin" : ""}/>Actualizar</button></div><section className="empty-state-grid"><article className="empty-card primary-empty"><div className="empty-card-top"><span>JORNADA</span><Power size={18}/></div><h2>{shiftActive ? "Estás conectado a tu zona." : "Tu jornada empieza aquí."}</h2><p>{shiftActive ? "El Fleet puede enviarte ofertas mientras mantengas la jornada activa." : "Consulta tus horarios y pulsa iniciar cuando llegue el turno asignado."}</p><button className="primary-button" onClick={() => showSection("Horarios")}>Ver horarios <ChevronRight size={17}/></button></article><article className="empty-card"><div className="empty-card-top"><span>RUTA</span><MapPinned size={18}/></div><h2>Mapa operativo preparado</h2><p>La ruta y las zonas de calor se activarán con ubicación consentida, pedidos y cobertura real.</p><button className="secondary-button" onClick={() => showSection("Mapa")}>Abrir mapa</button></article></section></>}
        </>}
      </section>
    </main>
  </div>;
}

function ActiveShiftView({ token, riderId, onMenu, onSupport, onStop, toast, onError }: { token: string; riderId: string; onMenu: () => void; onSupport: () => void; onStop: () => void; toast: string; onError: (message: string) => void }) {
  return <main className="active-shift-shell">
    <section className="active-map real-google-map-section" aria-label="Google Maps operativo en vivo">
      <LiveGoogleMap token={token} riderId={riderId} onError={onError} />
      <button className="active-menu-button" onClick={onMenu} aria-label="Abrir menú"><Menu size={25}/></button>
      <div className="online-pill"><span className="online-dot"/><span>Estado</span><strong>En línea</strong></div>
      <button className="active-help-button" onClick={onSupport} aria-label="Abrir soporte"><Headphones size={24}/></button>
      <section className="active-bottom-sheet"><p className="active-eyebrow">PIKI · JORNADA ACTIVA</p><h1>Mapa en vivo</h1><p>Google Maps muestra tu posición, la zona asignada y sus delimitaciones reales.</p><div className="active-sheet-actions"><button onClick={onStop} className="active-stop-button"><Power size={17}/> Finalizar jornada</button><button onClick={onSupport} className="active-support-button"><Headphones size={17}/> Soporte</button></div></section>
    </section>
    {toast && <div className="toast active-toast" role="status"><ShieldCheck size={17}/>{toast}</div>}
  </main>;
}

function FeatureHeading({ eyebrow, title, lead, icon }: { eyebrow: string; title: string; lead: string; icon: React.ReactNode }) { return <div className="feature-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lead">{lead}</p></div><div className="feature-icon">{icon}</div></div>; }
function StatCard({ label, value, tone }: { label: string; value: number | string; tone: string }) { return <article className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{value === 0 ? "Sin actividad registrada" : "Periodo actual"}</small></article>; }
function SupportCard({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) { return <button className="support-card" onClick={onClick}><span className="support-icon">{icon}</span><span><strong>{title}</strong><small>{text}</small></span><ChevronRight size={18}/></button>; }
export default App;
