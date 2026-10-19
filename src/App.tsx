import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Bike,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  CreditCard,
  FileText,
  Gift,
  Headphones,
  LayoutDashboard,
  LifeBuoy,
  MapPinned,
  Menu,
  MessageCircle,
  Power,
  Settings,
  ShieldCheck,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import "./App.css";
import "./pwa-wallet-calendar.css";
import NotificationCenter from "./NotificationCenter";
import EmployeeAuthGate from "./EmployeeAuthGate";
import ActiveShiftScreen from "./components/ActiveShiftScreen";
import RiderIncentivesPanel from "./components/RiderIncentivesPanel";
import LiveGoogleMap from "./components/LiveGoogleMap";
import RiderSupportChatDialog, { type RiderSupportChatMessage } from "./components/RiderSupportChatDialog";
import RiderOrderChatDialog from "./components/RiderOrderChatDialog";
import OperationalActivation from "./components/OperationalActivation";
import { connectPikiRealtime } from "./realtime";
import {
  playRiderOrderAlert,
  playRiderShiftStart,
  primeRiderOrderAudio,
  type RiderAlertAudioContext,
} from "./orderAlert";
import {
  acceptRiderOffer,
  createRiderSupportTicket,
  loadMobilityAdvice,
  startTrackingSession,
  stopTrackingSession,
} from "./integrations/piki-api";
import type { CurrentShift, RiderOffer, Shift } from "./types/rider";
import { visibleOrderReference } from "./orderReference";
import { orderRiderQueue } from "./orderQueue";
import {
  clearStoredToken,
  getStoredToken,
  storeToken,
  markStoredTokenValidated,
} from "./authStorage";
import { requiresRiderAuthentication } from "./apiAuthPolicy";
import {
  startNativeBackgroundTracking,
  stopNativeBackgroundTracking,
  supportsNativeBackgroundTracking,
} from "./native/backgroundLocation";
import { publishPwaOperationSafety } from "./pwaOperationSafety";
import {
  shouldShowOperationalMap,
  shouldTrackLocationOnOperationalMap,
} from "./riderSectionPolicy";
type Status = "checking" | "ready" | "unavailable";
type CashWallet = {
  availableCents: number;
  collectedCents: number;
  handedOverCents: number;
  collectedEntries: number;
};
type ApplicationStatus = "idle" | "sending" | "sent" | "error";
type Stats = {
  completed: number;
  cancelled: number;
  accepted: number;
  rating: string;
  distance: string;
  dailyDeliveries: Array<{ date: string; completed: number }>;
};
type ApplicationDocumentType =
  | "identity"
  | "residence_permit"
  | "bank_certificate"
  | "driving_license"
  | "insurance"
  | "vehicle_registration"
  | "vehicle_technical_sheet"
  | "scooter_responsible_declaration"
  | "dgt_mvp_homologation";

async function encodeApplicationDocument(
  file: File,
  type: ApplicationDocumentType,
) {
  if (file.size < 1 || file.size > 2_500_000)
    throw new Error(`${file.name}: máximo 2,5 MB`);
  if (file.type && file.type !== "application/pdf")
    throw new Error(`${file.name}: solo se admiten documentos PDF.`);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-")
    throw new Error(`${file.name}: el archivo no contiene un PDF válido.`);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return {
    type,
    fileName: file.name,
    mimeType: "application/pdf",
    sizeBytes: file.size,
    sha256,
    contentBase64: btoa(binary),
  };
}

function formatOrderMoney(cents?: number) {
  return typeof cents === "number"
    ? (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })
    : "—";
}
function isPickupPhase(status: RiderOffer["status"]) {
  return ["pending", "accepted", "preparing", "ready_for_pickup"].includes(status);
}
function orderDestination(offer: RiderOffer) {
  return isPickupPhase(offer.status)
    ? offer.restaurant?.address || offer.restaurant?.name || "Dirección del Partner"
    : offer.deliveryAddress || "Dirección del cliente";
}
function orderStepIndex(status: RiderOffer["status"]) {
  if (status === "on_the_way") return 2;
  if (status === "picked_up") return 1;
  return 0;
}
const apiOrigin = (
  import.meta.env.VITE_API_URL ?? "https://api.pikidelivery.com"
).replace(/\/$/, "");
function authHeaders(token: string): Record<string, string> {
  return token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};
}
const nav = [
  ["Inicio", LayoutDashboard],
  ["Ofertas", Bell],
  ["Entregas", ClipboardList],
  ["Horarios", CalendarDays],
  ["Cartera", WalletCards],
  ["Incentivos", Gift],
  ["Estadísticas", Activity],
  ["Soporte", LifeBuoy],
  ["Cuenta", Settings],
] as const;
const riderSectionStorageKey = `piki-${location.hostname}-rider-section`;
function getInitialRiderSection(): string {
  const requested = new URLSearchParams(window.location.search).get("section");
  const isKnownSection = (value: string | null): value is string =>
    Boolean(value && (value === "Solicitar alta" || nav.some(([label]) => label === value)));
  if (isKnownSection(requested)) return requested;
  try {
    const saved = localStorage.getItem(riderSectionStorageKey);
    if (isKnownSection(saved)) return saved;
  } catch {
    // Storage can be unavailable in private browsing; the app still works.
  }
  return "Inicio";
}
const weekdayNames = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];
const supportTopics = [
  {
    id: "order",
    title: "Ayuda con un pedido",
    text: "Recogida, entrega, comercio o dirección",
    icon: ClipboardList,
    options: [
      "El comercio está cerrado",
      "El pedido no está preparado",
      "No encuentro la dirección",
      "Problema durante la entrega",
      "Pedido cancelado o incorrecto",
    ],
  },
  {
    id: "account",
    title: "Cuenta y acceso",
    text: "Inicio de sesión, datos y documentación",
    icon: Settings,
    options: [
      "No puedo iniciar sesión",
      "Cambiar teléfono o correo",
      "Actualizar documentación",
      "Cambiar vehículo",
      "Mi cuenta está bloqueada",
    ],
  },
  {
    id: "shifts",
    title: "Turnos y horarios",
    text: "Reservas, ausencias y zonas asignadas",
    icon: CalendarDays,
    options: [
      "No veo mi turno",
      "Quiero cambiar un turno",
      "No puedo iniciar la jornada",
      "Llegaré tarde al turno",
      "Duda sobre mi zona",
    ],
  },
  {
    id: "payments",
    title: "Cartera y pagos",
    text: "Liquidaciones, incentivos y propinas",
    icon: WalletCards,
    options: [
      "No veo una liquidación",
      "Importe incorrecto",
      "Propina o incentivo",
      "Datos bancarios",
      "Certificado o justificante",
    ],
  },
  {
    id: "safety",
    title: "Seguridad y emergencias",
    text: "Accidentes, amenazas y situaciones urgentes",
    icon: ShieldCheck,
    options: [
      "He tenido un accidente",
      "Incidente con un tercero",
      "El vehículo no es seguro",
      "Necesito asistencia urgente",
      "Quiero reportar una situación",
    ],
  },
  {
    id: "technical",
    title: "Problemas técnicos",
    text: "GPS, ofertas, sonido y errores de la app",
    icon: Zap,
    options: [
      "El GPS no actualiza",
      "No recibo ofertas",
      "No suena la alerta",
      "La aplicación se queda en blanco",
      "Veo un error 401 o de conexión",
    ],
  },
] as const;
const supportFaqs = [
  [
    "¿Cuándo puedo iniciar la jornada?",
    "Solo durante un turno activo asignado por Fleet. Fuera de horario el botón permanece bloqueado.",
  ],
  [
    "¿Quién puede ver mis datos?",
    "Admin y Fleet según sus permisos operativos. Los Riders no ven métricas internas de la flota.",
  ],
  [
    "¿Cómo recibo un pedido?",
    "Con la jornada activa, el sistema te ofrece repartos disponibles y la app emite sonido y vibración.",
  ],
  [
    "¿Qué hago si tengo un accidente?",
    "Prioriza tu seguridad, llama al 112 si existe riesgo y abre la categoría Seguridad y emergencias.",
  ],
] as const;
const whatsappNumber = String(
  import.meta.env.VITE_WHATSAPP_HELP_NUMBER ?? "",
).replace(/\D/g, "");
const manychatWhatsAppUrl = String(
  import.meta.env.VITE_MANYCHAT_WHATSAPP_URL ?? "",
);
function normalizeRiderShift(raw: Record<string, unknown>): Shift {
  const date = String(raw.date || "");
  const weekday = date
    ? new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: "Europe/Madrid" }).format(new Date(`${date}T12:00:00Z`))
    : "";
  const rawDay = String(raw.day || weekday);
  return {
    day: rawDay ? `${rawDay.slice(0, 1).toUpperCase()}${rawDay.slice(1)}` : "",
    date,
    start: String(raw.start || raw.startTime || ""),
    end: String(raw.end || raw.endTime || ""),
    zone: String(raw.zone || raw.zoneSlug || ""),
    status: String(raw.status || "planned") as Shift["status"],
  };
}

function App() {
  const [section, setSection] = useState(getInitialRiderSection);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("checking");
  const [authRequired, setAuthRequired] = useState(false);
  const [apiToken, setApiToken] = useState(() => getStoredToken());
  const [applicationStatus, setApplicationStatus] =
    useState<ApplicationStatus>("idle");
  const [formEditing, setFormEditing] = useState(false);
  const [error, setError] = useState("");
  const [shiftActive, setShiftActive] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [startConsentOpen, setStartConsentOpen] = useState(false);
  const [showOperations, setShowOperations] = useState(false);
  const [startedShiftNotice, setStartedShiftNotice] = useState(false);
  const [riderId, setRiderId] = useState("");
  const [riderProfile, setRiderProfile] = useState({ name: "", email: "", riderCode: "" });
  const [currentShift, setCurrentShift] = useState<CurrentShift>({
    eligible: false,
  });
  const [toast, setToast] = useState("");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [stats, setStats] = useState<Stats>({
    completed: 0,
    cancelled: 0,
    accepted: 0,
    rating: "—",
    distance: "—",
    dailyDeliveries: [],
  });
  const [cashWallet, setCashWallet] = useState<CashWallet>({
    availableCents: 0,
    collectedCents: 0,
    handedOverCents: 0,
    collectedEntries: 0,
  });
  const [offers, setOffers] = useState<RiderOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState("");
  const [orderActionBusy, setOrderActionBusy] = useState(false);
  const [supportTopic, setSupportTopic] = useState<string | null>(null);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [supportForm, setSupportForm] = useState({ subject: "", description: "", priority: "high" });
  const [supportFormBusy, setSupportFormBusy] = useState(false);
  const [supportFormMessage, setSupportFormMessage] = useState("");
  const [supportTicketId, setSupportTicketId] = useState("");
  const [supportTicketNumber, setSupportTicketNumber] = useState("");
  const [supportTicketStatus, setSupportTicketStatus] = useState("");
  const [supportAgentName, setSupportAgentName] = useState("");
  const [supportChatMessages, setSupportChatMessages] = useState<RiderSupportChatMessage[]>([]);
  const [supportChatDraft, setSupportChatDraft] = useState("");
  const [supportChatBusy, setSupportChatBusy] = useState(false);
  const [supportChatOpen, setSupportChatOpen] = useState(false);
  const [supportChatError, setSupportChatError] = useState("");
  const [supportChatOrderLabel, setSupportChatOrderLabel] = useState("");
  const [supportPeerTyping, setSupportPeerTyping] = useState(false);
  const [unreadSupportMessages, setUnreadSupportMessages] = useState(0);
  const [unreadCustomerMessages, setUnreadCustomerMessages] = useState(0);
  const [orderChatOrder, setOrderChatOrder] = useState<RiderOffer | null>(null);
  const closeSupportChat = useCallback(() => setSupportChatOpen(false), []);
  const knownOfferIdsRef = useRef<Set<string> | null>(null);
  const lastOfferAtRef = useRef(0);
  const lastMobilityAlertRef = useRef("");
  const audioContextRef = useRef<RiderAlertAudioContext | null>(null);
  const assignedOrderRef = useRef(false);
  const riderRefreshInFlightRef = useRef(false);
  const riderRefreshQueuedRef = useRef(false);
  const loadRiderDataRef = useRef<() => void>(() => undefined);
  const activeOrder = orderRiderQueue(offers.filter((offer) => offer.assignmentState === "assigned"))[0];

  useEffect(() => {
    const updateFormEditing = () => {
      const activeElement = document.activeElement;
      setFormEditing(activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || activeElement instanceof HTMLSelectElement);
    };
    const deferFormEditingCheck = () => window.setTimeout(updateFormEditing, 0);
    document.addEventListener("focusin", updateFormEditing);
    document.addEventListener("focusout", deferFormEditingCheck);
    return () => {
      document.removeEventListener("focusin", updateFormEditing);
      document.removeEventListener("focusout", deferFormEditingCheck);
    };
  }, []);

  useEffect(() => {
    publishPwaOperationSafety({
      known: true,
      active: Boolean(activeOrder)
        || orderActionBusy
        || shiftBusy
        || supportFormBusy
        || supportChatBusy
        || applicationStatus === "sending"
        || startConsentOpen
        || formEditing,
    });
  }, [activeOrder, applicationStatus, formEditing, orderActionBusy, shiftBusy, startConsentOpen, supportChatBusy, supportFormBusy]);

  const playAssignmentAlert = useCallback(() => {
    playRiderOrderAlert(audioContextRef);
  }, []);

  const loadRiderData = useCallback(async () => {
    if (!apiToken) return;
    if (riderRefreshInFlightRef.current) {
      riderRefreshQueuedRef.current = true;
      return;
    }
    riderRefreshInFlightRef.current = true;
    const headers = authHeaders(apiToken);
    try {
      const sessionResponse = await fetch(
        `${apiOrigin}/api/v1/riders/session`,
        { headers },
      );
      if (!sessionResponse.ok) {
        if (await requiresRiderAuthentication(sessionResponse)) {
          clearStoredToken();
          setApiToken("");
          setAuthRequired(true);
          setRiderId("");
          setShiftActive(false);
          setOffers([]);
        }
        return;
      }
      const sessionData = (await sessionResponse.json()) as {
        rider?: { id?: string; name?: string; email?: string; riderCode?: string; status?: string };
      };
      const id = String(sessionData.rider?.id || "");
      if (!id) return;
      markStoredTokenValidated();
      setRiderId(id);
      setRiderProfile({ name: String(sessionData.rider?.name || ""), email: String(sessionData.rider?.email || ""), riderCode: String(sessionData.rider?.riderCode || "") });
      const [slotResponse, statsResponse, shiftResponse, cashResponse] =
        await Promise.all([
          fetch(`${apiOrigin}/api/v1/riders/${id}/slots`, { headers, cache: "no-store" }),
          fetch(`${apiOrigin}/api/v1/riders/statistics`, { headers }),
          fetch(`${apiOrigin}/api/v1/riders/${id}/shift`, { headers, cache: "no-store" }),
          fetch(`${apiOrigin}/api/v1/riders/${id}/cash-wallet`, { headers }),
        ]);
      if (slotResponse.ok) {
        const data = (await slotResponse.json()) as { slots?: Array<Record<string, unknown>> };
        setShifts(Array.isArray(data.slots) ? data.slots.map(normalizeRiderShift) : []);
      }
      if (shiftResponse.ok) {
        const data = (await shiftResponse.json()) as CurrentShift & { shift?: Record<string, unknown> | null };
        setCurrentShift({ ...data, shift: data.shift ? normalizeRiderShift(data.shift) : null });
        setShiftActive(data.shift?.status === "active");
      }
      if (statsResponse.ok) {
        const data = (await statsResponse.json()) as {
          statistics?: Partial<Stats>;
        };
        setStats((prev) => ({ ...prev, ...(data.statistics ?? {}) }));
      }
      if (cashResponse?.ok) {
        const data = (await cashResponse.json()) as { wallet?: CashWallet };
        if (data.wallet) setCashWallet(data.wallet);
      }
      setStatus("ready");
    } catch {
      setStatus("unavailable");
      /* Panels remain usable while the API is unavailable. */
    } finally {
      riderRefreshInFlightRef.current = false;
      if (riderRefreshQueuedRef.current) {
        riderRefreshQueuedRef.current = false;
        window.setTimeout(() => loadRiderDataRef.current(), 0);
      }
    }
  }, [apiToken]);
  useEffect(() => {
    loadRiderDataRef.current = () => { void loadRiderData(); };
  }, [loadRiderData]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRiderData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRiderData]);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadRiderData();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
    };
  }, [loadRiderData]);
  useEffect(() => {
    if (!apiToken) return;
    // SSE actualiza al instante cuando llega el evento, pero el polling evita
    // que un móvil suspendido o una reconexión perdida deje el calendario viejo.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadRiderData();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [apiToken, loadRiderData]);
  useEffect(() => {
    try {
      localStorage.setItem(riderSectionStorageKey, section);
    } catch {
      // Section persistence is best-effort and must not block navigation.
    }
  }, [section]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!apiToken || !riderId || !shiftActive) {
      knownOfferIdsRef.current = null; // oxlint-disable-next-line react/set-state-in-effect
      setOffersLoading(false);
      setOffersError("");
      return;
    }
    let disposed = false;
    let pollInFlight = false;
    const pollOffers = async () => {
      if (pollInFlight || disposed) return;
      pollInFlight = true;
      const initialSync = knownOfferIdsRef.current === null;
      if (!disposed && initialSync) setOffersLoading(true);
      try {
        const response = await fetch(
          `${apiOrigin}/api/v1/riders/${riderId}/offers`,
          { headers: authHeaders(apiToken) },
        );
        if (!response.ok || disposed) {
          const requiresAuthentication = !disposed && await requiresRiderAuthentication(response);
          if (requiresAuthentication && !disposed) {
            clearStoredToken();
            setApiToken("");
            setAuthRequired(true);
            setRiderId("");
            setShiftActive(false);
            setOffers([]);
          }
          if (!disposed)
            setOffersError("No se han podido sincronizar los pedidos");
          return;
        }
        const data = (await response.json()) as { offers?: RiderOffer[] };
        const nextOffers = Array.isArray(data.offers) ? data.offers : [];
        assignedOrderRef.current = nextOffers.some(
          (offer) => offer.assignmentState === "assigned",
        );
        setOffers(nextOffers);
        setOffersError("");
        const currentIds = new Set(
          nextOffers.map((offer) => String(offer._id)),
        );
        if (knownOfferIdsRef.current === null) {
          knownOfferIdsRef.current = currentIds;
          return;
        }
        const hasNewOffer = nextOffers.some(
          (offer) => !knownOfferIdsRef.current?.has(String(offer._id)),
        );
        knownOfferIdsRef.current = currentIds;
        if (hasNewOffer) {
          lastOfferAtRef.current = Date.now();
          playAssignmentAlert();
          setToast("Nuevo reparto asignado. Revisa tus ofertas.");
        }
      } catch {
        if (!disposed)
          setOffersError("La red no está disponible temporalmente");
      } finally {
        if (!disposed && initialSync) setOffersLoading(false);
        pollInFlight = false;
      }
    };
    void pollOffers();
    const timer = window.setInterval(() => {
      void pollOffers();
    }, 5000);
    const refreshOffersWhenVisible = () => {
      if (document.visibilityState === "visible") void pollOffers();
    };
    document.addEventListener("visibilitychange", refreshOffersWhenVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshOffersWhenVisible);
    };
  }, [apiToken, riderId, shiftActive, playAssignmentAlert]);
  useEffect(() => {
    if (!apiToken || !riderId) return;
    return connectPikiRealtime({
      apiOrigin,
      token: apiToken,
      surface: "rider",
      onAuthExpired: () => {
        clearStoredToken();
        setApiToken("");
        setAuthRequired(true);
        setRiderId("");
        setShiftActive(false);
        setToast("Tu sesión ha caducado. Inicia sesión de nuevo para recibir ofertas.");
      },
      onAuthorizationError: () => {
        setToast("Tu cuenta no tiene permiso para el canal de Riders. Contacta con Operaciones.");
      },
      onEvent: (event) => {
        if (event.type === "rider.schedule_updated") {
          void loadRiderData();
          // Si el navegador ya ha permitido audio durante esta sesión,
          // avisamos también del nuevo turno; si aplica autoplay, el botón
          // seguirá apareciendo mediante la consulta periódica del turno.
          primeRiderOrderAudio(audioContextRef);
          playRiderShiftStart();
          setToast("Tus horarios se han actualizado.");
          return;
        }
        if (event.type === "support.message") {
          setUnreadSupportMessages((count) => count + 1);
          setToast("Soporte PIKI ha respondido a tu incidencia.");
          return;
        }
        if (event.type === "order.message") {
          setUnreadCustomerMessages((count) => count + 1);
          setToast("Tienes un mensaje nuevo del cliente.");
          return;
        }
        if (!["order.rider_offer", "order.status_changed", "order.rider_arrived_at_partner"].includes(event.type)) return;
        void fetch(`${apiOrigin}/api/v1/riders/${riderId}/offers`, {
          headers: authHeaders(apiToken),
        })
          .then(async (response) => {
            if (!response.ok) return;
            const data = (await response.json()) as { offers?: RiderOffer[] };
            setOffers(Array.isArray(data.offers) ? data.offers : []);
            setOffersError("");
            if (event.type === "order.rider_offer") {
              lastOfferAtRef.current = Date.now();
              playAssignmentAlert();
              setToast("Nueva oferta de reparto. Revísala en la pantalla de jornada.");
            }
          })
          .catch(() => undefined);
      },
    });
  }, [apiOrigin, apiToken, riderId, loadRiderData, playAssignmentAlert]);
  useEffect(() => {
    if (!apiToken || !riderId) return;
    let disposed = false;
    const checkShift = async () => {
      try {
        const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/shift`, { headers: authHeaders(apiToken), cache: "no-store" });
        if (!response.ok || disposed) return;
        const data = await response.json() as CurrentShift & { shift?: Record<string, unknown> | null };
        const nextShift = data.shift ? normalizeRiderShift(data.shift) : null;
        if (nextShift?.status === "active") {
          setCurrentShift({ ...data, shift: nextShift });
          setShiftActive(true);
          return;
        }
        if (!shiftActive) {
          setCurrentShift({ ...data, shift: nextShift });
          return;
        }
        setCurrentShift({ ...data, shift: nextShift });
        setShiftActive(false);
        setStartedShiftNotice(false);
        setToast("Tu jornada ha finalizado automáticamente al terminar el slot.");
      } catch { /* el siguiente ciclo vuelve a consultar el estado oficial */ }
    };
    void checkShift();
    // Fleet puede guardar el turno mientras Rider ya tiene la sesión abierta;
    // no debemos depender exclusivamente de que el evento SSE llegue al navegador.
    const timer = window.setInterval(() => void checkShift(), 10000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [apiOrigin, apiToken, riderId, shiftActive]);
  useEffect(() => {
    if (!apiToken || !riderId || !shiftActive) {
      lastMobilityAlertRef.current = "";
      return;
    }
    let disposed = false;
    const pollMobility = async () => {
      try {
        const lowActivityMinutes =
          (Date.now() - lastOfferAtRef.current) / 60000;
        const advice = await loadMobilityAdvice(
          apiToken,
          riderId,
          lowActivityMinutes,
        );
        if (disposed || !advice.shouldMove || !advice.targetZone) return;
        const alertKey = `${advice.currentZone?.slug || "unknown"}:${advice.targetZone.slug}`;
        if (lastMobilityAlertRef.current === alertKey) return;
        lastMobilityAlertRef.current = alertKey;
        playAssignmentAlert();
        setToast(
          `Baja actividad en ${advice.currentZone?.name || "tu zona"}. Hay más demanda cerca: ${advice.targetZone.name}.`,
        );
      } catch {
        /* La recomendación no bloquea la jornada si la API está temporalmente indisponible. */
      }
    };
    void pollMobility();
    const timer = window.setInterval(() => {
      void pollMobility();
    }, 30000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [apiToken, riderId, shiftActive, playAssignmentAlert]);

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplicationStatus("sending");
    setError("");
    const form = new FormData(event.currentTarget);
    const vehicle = String(form.get("vehicle") || "electric_scooter");
    const documentInputs: Array<[ApplicationDocumentType, string]> = [
      ["identity", "document_identity"],
      ["bank_certificate", "document_bank_certificate"],
    ];
    if (["motorcycle", "scooter", "car"].includes(vehicle))
      documentInputs.push(
        ["driving_license", "document_driving_license"],
        ["insurance", "document_insurance"],
        ["vehicle_registration", "document_vehicle_registration"],
        ["vehicle_technical_sheet", "document_vehicle_technical_sheet"],
      );
    if (vehicle === "electric_scooter")
      documentInputs.push(
        ["scooter_responsible_declaration", "document_scooter_declaration"],
        ["dgt_mvp_homologation", "document_dgt_mvp"],
      );
    try {
      const documents = await Promise.all(
        documentInputs.map(async ([type, field]) => {
          const value = form.get(field);
          if (!(value instanceof File) || !value.size)
            throw new Error(
              `Debes adjuntar todos los documentos requeridos: falta ${type}.`,
            );
          return encodeApplicationDocument(value, type);
        }),
      );
      const body = {
        name: String(form.get("name") || ""),
        email: String(form.get("email") || ""),
        phone: String(form.get("phone") || ""),
        city: String(form.get("city") || "Xàtiva"),
        vehicle,
        availability: String(form.get("availability") || ""),
        socialSecurityNumber: String(form.get("socialSecurityNumber") || ""),
        identityVerificationMethod: "online_scan",
        safetyDeclarationAccepted:
          form.get("safetyDeclarationAccepted") === "on",
        documents,
        website: String(form.get("website") || ""),
      };
      const response = await fetch(`${apiOrigin}/api/v1/riders/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "No se pudo enviar la solicitud");
      setApplicationStatus("sent");
      event.currentTarget.reset();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo enviar la solicitud",
      );
      setApplicationStatus("error");
    }
  }

  const activeShifts = useMemo(
    () =>
      weekdayNames.map(
        (day) =>
          shifts.find((shift) => shift.day === day) ?? {
            day,
            date: "",
            start: "",
            end: "",
            zone: "",
            status: "pending" as const,
          },
      ),
    [shifts],
  );
  const showApplication = section === "Solicitar alta";

  function showSection(next: string) {
    setSection(next);
    setOpen(false);
    setProfileOpen(false);
  }
  async function toggleShift() {
    if (shiftActive) {
      setToast("La jornada se cerrará automáticamente al finalizar tu slot.");
      return;
    }
    if (!riderId || shiftBusy) {
      if (!riderId)
        setToast("No hay una cuenta Rider vinculada a esta sesión.");
      return;
    }
    if (!shiftActive && !currentShift.eligible) {
      setToast(
        "No hay un turno disponible ahora. Revisa Horarios o contacta con Fleet.",
      );
      return;
    }
    if (!shiftActive && !startConsentOpen) {
      setStartConsentOpen(true);
      return;
    }
    setStartConsentOpen(false);
    const endpoint = "start";
    setShiftBusy(true);
    try {
      if (!shiftActive) {
        if (!navigator.geolocation) {
          setToast(
            "Este dispositivo no ofrece GPS. No se puede iniciar la jornada.",
          );
          return;
        }
        const position = await new Promise<GeolocationPosition>(
          (resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              maximumAge: 5_000,
              timeout: 15_000,
            }),
        );
        const locationResponse = await fetch(
          `${apiOrigin}/api/v1/riders/${riderId}/location`,
          {
            method: "POST",
            headers: {
              ...authHeaders(apiToken),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            }),
          },
        );
        if (!locationResponse.ok) {
          const payload = await locationResponse.json().catch(() => ({}));
          setToast(
            payload.message ||
              payload.error ||
              "No se pudo validar el GPS real.",
          );
          return;
        }
      }
      const response = await fetch(
        `${apiOrigin}/api/v1/riders/${riderId}/shift/${endpoint}`,
        { method: "POST", headers: authHeaders(apiToken) },
      );
      const data = (await response.json()) as {
        message?: string;
        error?: string;
        shift?: Shift;
        locationRequired?: boolean;
        now?: { date: string; time: string };
      };
      if (!response.ok) {
        setToast(
          data.message ||
            "No puedes iniciar: no hay un turno reservado activo.",
        );
        return;
      }
      if (data.locationRequired) {
        setToast(
          data.message ||
            "La jornada sigue bloqueada: activa la ubicación y comparte una posición GPS real.",
        );
        return;
      }
      const nowActive = true;
      setShiftActive(true);
      setStartedShiftNotice(true);
      setCurrentShift((previous) => ({
        ...previous,
        eligible: !nowActive,
        selfStartAllowed: false,
        shift: data.shift ?? previous.shift,
      }));
      setShowOperations(false);
      if (!shiftActive) {
        primeRiderOrderAudio(audioContextRef);
        playRiderShiftStart();
      }
      setToast("Jornada iniciada. Se cerrará automáticamente al finalizar el slot.");
      await loadRiderData();
    } catch {
      setToast("No se pudo validar el turno con la API.");
    } finally {
      setShiftBusy(false);
    }
  }
  async function offerAction(
    orderId: string,
    action: "on_the_way",
  ) {
    if (orderActionBusy) return;
    setOrderActionBusy(true);
    try {
      const endpoint = `/api/v1/orders/${orderId}/transitions`;
      const body = {
        status: action,
        actorRole: "rider",
        reason: "Ruta iniciada hacia el cliente",
      };
      const response = await fetch(`${apiOrigin}${endpoint}`, {
        method: "POST",
        headers: {
          ...authHeaders(apiToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setToast(
          data.message || data.error || "No se pudo actualizar el reparto.",
        );
        await loadRiderData();
        return;
      }
      setOffers((previous) => previous.map((offer) => offer._id === orderId ? { ...offer, assignmentState: "assigned", assignmentExpiresAt: null, status: action } : offer));
      setToast("Ruta iniciada. El Customer ya ve el seguimiento en tiempo real.");
      await loadRiderData();
    } catch {
      setToast(
        "No se pudo conectar con la API. Se recargará el estado para evitar dobles acciones.",
      );
      await loadRiderData();
    } finally {
      setOrderActionBusy(false);
    }
  }
  async function acceptRiderOfferAction(orderId: string) {
    if (orderActionBusy || !apiToken || !riderId) return;
    setOrderActionBusy(true);
    try {
      const result = await acceptRiderOffer(apiToken, riderId, orderId);
      setToast(result.message || "Reparto aceptado. Dirígete al Partner.");
      await loadRiderData();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo aceptar el reparto.");
      await loadRiderData();
    } finally {
      setOrderActionBusy(false);
    }
  }
  async function confirmDelivery(orderId: string, deliveryQr: string) {
    if (orderActionBusy) return;
    const normalizedDeliveryQr = deliveryQr.trim();
    if (!normalizedDeliveryQr) {
      setToast("El cliente debe proporcionarte su QR o PIN antes de confirmar la entrega.");
      return;
    }
    setOrderActionBusy(true);
    try {
      const response = await fetch(
        `${apiOrigin}/api/v1/riders/${riderId}/orders/${orderId}/confirm-delivery`,
        {
          method: "POST",
          headers: {
            ...authHeaders(apiToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deliveryQr: normalizedDeliveryQr, deliveryPin: normalizedDeliveryQr }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setToast(
          data.message || data.error || "No se pudo confirmar la entrega.",
        );
        await loadRiderData();
        return;
      }
      setOffers((previous) =>
        previous.filter((offer) => offer._id !== orderId),
      );
      setToast(
        data.message ||
          "Entrega confirmada. El reparto se ha cerrado correctamente.",
      );
      await loadRiderData();
    } catch {
      setToast(
        "No se pudo confirmar por red. Comprueba el pedido antes de reintentar.",
      );
      await loadRiderData();
    } finally {
      setOrderActionBusy(false);
    }
  }
  async function confirmPickup(orderId: string) {
    if (orderActionBusy) return;
    setOrderActionBusy(true);
    // El Rider debe ver la siguiente tarjeta sin esperar la latencia de red.
    // Si el backend rechaza la operación, loadRiderData restaura el estado canónico.
    setOffers((previous) => previous.map((offer) => offer._id === orderId ? { ...offer, status: "picked_up" } : offer));
    try {
      const response = await fetch(
        `${apiOrigin}/api/v1/riders/${riderId}/orders/${orderId}/confirm-pickup`,
        {
          method: "POST",
          headers: {
            ...authHeaders(apiToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setToast(
          data.message ||
            data.error ||
            "El establecimiento no ha validado la recogida.",
        );
        await loadRiderData();
        return;
      }
      const confirmedOrder = data.order as RiderOffer | undefined;
      if (confirmedOrder) {
        setOffers((previous) => previous.map((offer) => offer._id === orderId
          ? { ...offer, ...confirmedOrder, status: confirmedOrder.status || "picked_up", riderArrivedAt: confirmedOrder.riderArrivedAt || offer.riderArrivedAt }
          : offer));
      } else {
        setOffers((previous) => previous.map((offer) => offer._id === orderId ? { ...offer, status: "picked_up" } : offer));
      }
      setToast(
        data.message ||
          "Recogida confirmada. Ya puedes iniciar la ruta hacia el cliente.",
      );
      await loadRiderData();
      // La respuesta de la mutación es la fuente de verdad inmediata. Si la
      // reconciliación REST llega desde una réplica con unos milisegundos de
      // retraso, no debemos volver a pintar la tarjeta de Partner.
      setOffers((previous) => previous.map((offer) => offer._id === orderId
        ? { ...offer, ...(confirmedOrder || {}), status: "picked_up" }
        : offer));
    } catch {
      setToast(
        "No se pudo validar la recogida. Comprueba tu ubicación GPS y vuelve a intentarlo.",
      );
      await loadRiderData();
    } finally {
      setOrderActionBusy(false);
    }
  }
  async function submitSupportTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiToken || !riderId || !supportForm.subject.trim() || !supportForm.description.trim()) return;
    setSupportFormBusy(true); setSupportFormMessage(""); setSupportChatError("");
    try {
      const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ subject: supportForm.subject.trim(), description: supportForm.description.trim(), priority: supportForm.priority, orderId: activeOrder?._id }) });
      const data = await response.json().catch(() => ({})) as { message?: string; error?: string; ticket?: { id?: string; ticketNumber?: string; status?: string; messages?: RiderSupportChatMessage[] } };
      if (!response.ok) throw new Error(data.message || data.error || "No se pudo enviar la incidencia.");
      const ticketId = String(data.ticket?.id || "");
      if (!ticketId) throw new Error("Soporte no devolvió el identificador del caso.");
      setSupportForm({ subject: "", description: "", priority: "high" });
      setSupportTicketId(ticketId);
      setSupportTicketNumber(data.ticket?.ticketNumber || "");
      setSupportTicketStatus(data.ticket?.status || "open");
      setSupportAgentName("");
      setSupportChatMessages(Array.isArray(data.ticket?.messages) ? data.ticket.messages : []);
      setSupportChatOrderLabel(activeOrder ? `Pedido ${visibleOrderReference(activeOrder.publicCode, activeOrder._id)} · en reparto` : "Incidencia de soporte");
      setSupportChatDraft("");
      setSupportChatOpen(true);
    } catch (error) { setSupportFormMessage(error instanceof Error ? error.message : "No se pudo enviar la incidencia."); } finally { setSupportFormBusy(false); }
  }
  const refreshSupportChat = useCallback(async () => {
    if (!apiToken || !riderId || !supportTicketId) return;
    try {
      const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets`, { headers: { ...authHeaders(apiToken), "X-PIKI-Surface": "rider" } });
      if (!response.ok) return;
      const data = await response.json() as { tickets?: Array<{ _id: string; ticketNumber?: string; status?: string; orderId?: string | null; assignedTo?: { name?: string } | null; messages?: RiderSupportChatMessage[]; agentTypingAt?: string | null }> };
      const ticket = (data.tickets || []).find((item) => String(item._id) === supportTicketId);
      if (ticket) {
        setSupportTicketNumber(ticket.ticketNumber || "");
        setSupportTicketStatus(ticket.status || "open");
        setSupportAgentName(ticket.assignedTo?.name || ticket.messages?.find((message) => message.senderRole === "support")?.senderName || "");
        setSupportChatOrderLabel(ticket.orderId ? "Incidencia vinculada a un pedido" : "Consulta de soporte");
        setSupportPeerTyping(Boolean(ticket.agentTypingAt && Date.now() - new Date(ticket.agentTypingAt).getTime() < 5000));
        setSupportChatMessages(Array.isArray(ticket.messages) ? ticket.messages : []);
      }
    } catch { /* el chat conserva el último estado mientras vuelve la red */ }
  }, [apiToken, riderId, supportTicketId]);
  useEffect(() => {
    if (!apiToken || !riderId || supportTicketId) return;
    void (async () => { try { const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets`, { headers: { ...authHeaders(apiToken), "X-PIKI-Surface": "rider" } }); if (!response.ok) return; const data = await response.json() as { tickets?: Array<{ _id: string; ticketNumber?: string; status?: string; orderId?: string | null }> }; const openTicket = (data.tickets || []).find((item) => !["closed", "resolved"].includes(item.status || "")); if (openTicket) { setSupportTicketId(String(openTicket._id)); setSupportTicketNumber(openTicket.ticketNumber || ""); setSupportTicketStatus(openTicket.status || "open"); setSupportChatOrderLabel(openTicket.orderId ? "Incidencia vinculada a un pedido" : "Consulta de soporte"); } } catch { /* sin conexión, se reintentará al abrir o enviar una incidencia */ } })();
  }, [apiToken, riderId, supportTicketId]);
  useEffect(() => { if (!supportTicketId || !supportChatOpen) return; void refreshSupportChat(); const timer = window.setInterval(() => void refreshSupportChat(), 2000); return () => window.clearInterval(timer); }, [supportTicketId, supportChatOpen, refreshSupportChat]);
  useEffect(() => {
    if (!supportChatOpen || !apiToken || !riderId || !supportTicketId || !supportChatDraft.trim() || ["closed", "resolved"].includes(supportTicketStatus)) return;
    const ping = () => void fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets/${supportTicketId}/typing`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ active: true }) }).catch(() => undefined);
    ping(); const timer = window.setInterval(ping, 1500);
    return () => { window.clearInterval(timer); void fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets/${supportTicketId}/typing`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ active: false }) }).catch(() => undefined); };
  }, [supportChatOpen, apiToken, riderId, supportTicketId, supportChatDraft, supportTicketStatus]);
  async function sendSupportChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const body = supportChatDraft.trim(); if (!body || !apiToken || !riderId || !supportTicketId || supportChatBusy) return; setSupportChatBusy(true); setSupportChatError("");
    try { const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets/${supportTicketId}/messages`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ body }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || data.error || "El chat está cerrado."); setSupportChatDraft(""); if (data.ticket?.messages) setSupportChatMessages(data.ticket.messages); } catch (error) { setSupportChatError(error instanceof Error ? error.message : "No se pudo enviar el mensaje."); } finally { setSupportChatBusy(false); }
  }
  function supportAction(label: string) {
    setSupportTopic(label);
    setFaqOpen(null);
  }
  async function createSupportTicket(topic: string, option: string) {
    if (!apiToken || !riderId) {
      setToast("Inicia sesión como Rider para enviar una incidencia a Soporte PIKI.");
      return;
    }
    const activeOrder = orderRiderQueue(offers.filter((offer) => offer.assignmentState === "assigned"))[0];
    const priority = topic === "safety" ? "urgent" : topic === "order" ? "high" : "normal";
    const orderContext = activeOrder
      ? `Pedido ${visibleOrderReference(activeOrder.publicCode, activeOrder._id)}. Estado: ${activeOrder.status}. Comercio: ${activeOrder.restaurant?.name || "no disponible"}. Dirección relacionada: ${activeOrder.status === "ready_for_pickup" || activeOrder.status === "preparing" ? activeOrder.restaurant?.address || "no disponible" : activeOrder.deliveryAddress || "no disponible"}.`
      : "No hay un pedido activo vinculado en este momento.";
    try {
      const ticket = await createRiderSupportTicket({
        token: apiToken,
        riderId,
        subject: `${topic === "order" ? "Pedido" : "Soporte Rider"}: ${option}`,
        description: `Incidencia seleccionada desde la app Rider: ${option}.\n\nContexto automático: ${orderContext}`,
        priority,
        orderId: activeOrder?._id,
      });
      setSupportTicketId(ticket.id);
      setSupportTicketNumber(ticket.ticketNumber || "");
      setSupportTicketStatus(ticket.status || "open");
      setSupportAgentName("");
      setSupportChatMessages([]);
      setSupportChatDraft("");
      setSupportChatError("");
      setSupportChatOrderLabel(activeOrder ? `Pedido ${visibleOrderReference(activeOrder.publicCode, activeOrder._id)} · en reparto` : "Incidencia de soporte");
      setSupportChatOpen(true);
      setSupportTopic(null);
    } catch (ticketError) {
      const message = ticketError instanceof Error ? ticketError.message : "No se pudo crear la incidencia.";
      setToast(`${message} Puedes usar WhatsApp como alternativa.`);
    }
  }
  function openWhatsApp(topic: string, option: string) {
    const base =
      manychatWhatsAppUrl ||
      (whatsappNumber ? `https://wa.me/${whatsappNumber}` : "");
    if (!base) {
      setToast("El centro de ayuda WhatsApp todavía no está configurado.");
      return;
    }
    const separator = base.includes("?") ? "&" : "?";
    const message = encodeURIComponent(`PIKI RIDER | ${topic} | ${option}`);
    window.open(
      `${base}${separator}text=${message}`,
      "_blank",
      "noopener,noreferrer",
    );
  }
  const [profileOpen, setProfileOpen] = useState(false);
  const handleApiError = useCallback((message: string) => {
    if (
      message.includes("API 401") ||
      message.includes("AUTHENTICATION_REQUIRED")
    ) {
      clearStoredToken();
      setApiToken("");
      setAuthRequired(false);
      setToast("Tu sesión ha caducado. Vuelve a iniciar sesión.");
      return;
    }
    setToast(message);
  }, []);

  const nativeTracking = supportsNativeBackgroundTracking();
  const appVersion = String(import.meta.env.VITE_APP_VERSION || "1.0.4");
  const trackingSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!nativeTracking || !shiftActive || !apiToken || !riderId) {
      void stopNativeBackgroundTracking();
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const session = await startTrackingSession(apiToken, riderId, Capacitor.getPlatform() === "ios" ? "ios" : "android", appVersion, "location-v1");
        if (disposed) return;
        trackingSessionRef.current = session._id;
        await startNativeBackgroundTracking({ apiOrigin, token: apiToken, riderId, sessionId: session._id, onError: (message) => { if (!disposed) setToast(message); } });
      } catch (error) {
        if (!disposed) setToast(error instanceof Error ? error.message : "No se pudo iniciar la sesión de tracking.");
      }
    })();
    return () => {
      disposed = true;
      void stopNativeBackgroundTracking();
      const sessionId = trackingSessionRef.current;
      trackingSessionRef.current = null;
      if (sessionId) void stopTrackingSession(apiToken, riderId, sessionId);
    };
  }, [apiOrigin, apiToken, appVersion, nativeTracking, riderId, shiftActive]);

  if (!apiToken || authRequired)
    return (
      <main className="page-content">
        <EmployeeAuthGate
          apiOrigin={apiOrigin}
          onAuthenticated={(token) => {
            storeToken(token);
            setApiToken(token);
            setAuthRequired(false);
            window.dispatchEvent(new Event("piki-authenticated"));
            setStatus("checking");
          }}
        />
      </main>
    );
  if (shiftActive && !showOperations && riderId)
    return (
      <>
        <ActiveShiftScreen
          token={apiToken}
          riderId={riderId}
          currentShift={currentShift}
          offers={offers}
          offersLoading={offersLoading}
          offersError={offersError}
          startedShiftNotice={startedShiftNotice}
          toast={toast}
          nativeTracking={nativeTracking}
          onDismissStartNotice={() => setStartedShiftNotice(false)}
          onOpenOperations={() => setShowOperations(true)}
          onOpenSupport={() => { setUnreadSupportMessages(0); setShowOperations(true); showSection("Soporte"); if (supportTicketId) setSupportChatOpen(true); }}
          onOpenOrderChat={(order) => { setUnreadCustomerMessages(0); setOrderChatOrder(order); }}
          unreadMessageCount={unreadSupportMessages + unreadCustomerMessages}
          onRefreshOffers={() => {
            setOffersError("");
            void loadRiderData();
          }}
          onAcceptOffer={(orderId) => void acceptRiderOfferAction(orderId)}
          actionBusy={orderActionBusy}
          onOfferAction={(orderId, action) => void offerAction(orderId, action)}
          onConfirmPickup={(orderId) => void confirmPickup(orderId)}
          onConfirmDelivery={(orderId, deliveryQr) =>
            void confirmDelivery(orderId, deliveryQr)
          }
          onError={handleApiError}
        />
        {orderChatOrder && <RiderOrderChatDialog token={apiToken} riderId={riderId} order={orderChatOrder} onClose={() => setOrderChatOrder(null)} />}
      </>
    );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand-block">
          <img className="brand-mark brand-logo" src="/piki-mascot.png" alt="PIKI" />
          <div>
            <strong>piki</strong>
            <span>Riders</span>
          </div>
          <button
            className="close-menu"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="nav-list">
          <p className="nav-label">TU JORNADA</p>
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              className={`nav-item ${section === label ? "nav-item-active" : ""}`}
              onClick={() => showSection(label)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="support-dot" />
          <div>
            <strong>Red PIKI</strong>
            <span>{status === "ready" ? "Conectada" : "Comprobando"}</span>
          </div>
          <ChevronRight size={16} />
        </div>
      </aside>
      {open && (
        <button
          className="backdrop"
          onClick={() => setOpen(false)}
          aria-label="Cerrar navegación"
        />
      )}
      <main className="main-content">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu size={21} />
          </button>
          <div className="location-pill">
            <Bike size={16} />
            <span>Operativa de reparto</span>
            <span className="status-dot" />
          </div>
          <div className="topbar-actions">
            <NotificationCenter
              apiOrigin={apiOrigin}
              token={apiToken}
              surface="rider"
              onUnreadChange={({ support, customer }) => {
                setUnreadSupportMessages(support);
                setUnreadCustomerMessages(customer);
              }}
            />
            <button
              className="icon-button rider-support-message-button"
              onClick={() => { setUnreadSupportMessages(0); showSection("Soporte"); if (supportTicketId) setSupportChatOpen(true); }}
              aria-label={unreadSupportMessages ? `Abrir soporte: ${unreadSupportMessages} respuestas sin leer` : "Abrir soporte"}
            >
              <Headphones size={19} />
              {unreadSupportMessages > 0 && <b className="rider-message-badge" aria-hidden="true">{unreadSupportMessages > 9 ? "9+" : unreadSupportMessages}</b>}
            </button>
            <div className="profile-wrap">
              <button
                className="profile-trigger"
                onClick={() => setProfileOpen((value) => !value)}
                aria-expanded={profileOpen}
                aria-label="Abrir perfil"
              >
                <span className="user-avatar">R</span>
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <strong>{riderProfile.name || "Cuenta Rider"}</strong>
                  <span>{riderProfile.riderCode || riderProfile.email || "Perfil individual Rider"}</span>
                  <button onClick={() => showSection("Cuenta")}>
                    Ver mi cuenta
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <section className={`page-content ${section === "Inicio" ? "home-page-content" : ""}`}>
          {toast && (
            <div className="toast" role="status">
              <ShieldCheck size={17} />
              {toast}
            </div>
          )}
          {authRequired && (
            <EmployeeAuthGate
              apiOrigin={apiOrigin}
              onAuthenticated={(token) => {
                storeToken(token);
                setApiToken(token);
                setAuthRequired(false);
                setStatus("checking");
              }}
            />
          )}
          {showApplication ? (
            <section className="application-layout">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">PIKI · RIDER</p>
                  <h1>Solicita tu alta como Rider.</h1>
                  <p className="lead">
                    Solicita tu alta en PIKI. El equipo de Operaciones revisará tus
                    datos, vehículo y disponibilidad antes de activar tu cuenta.
                  </p>
                </div>
              </div>
              <div className="onboarding-grid">
                <article className="process-card">
                  <span className="step-number">01</span>
                  <h2>Cómo funciona</h2>
                  <p>
                    Envía tus datos y te contactaremos para validar
                    documentación, zona y disponibilidad.
                  </p>
                  <div className="process-line" />
                  <span className="step-number muted-step">02</span>
                  <h2>Revisión de Operaciones</h2>
                  <p>
                    Un responsable de zona revisa tu solicitud y agenda la
                    activación.
                  </p>
                  <div className="process-line" />
                  <span className="step-number muted-step">03</span>
                  <h2>Primer turno</h2>
                  <p>
                    Tras la aprobación, recibirás acceso a ofertas y podrás
                    conectarte en tu zona.
                  </p>
                </article>
                <form className="partner-form" onSubmit={submitApplication}>
                  <label>
                    Nombre y apellidos
                    <input
                      name="name"
                      required
                      minLength={2}
                      placeholder="Ej. Marta García"
                    />
                  </label>
                  <label>
                    Email
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="marta@email.com"
                    />
                  </label>
                  <label>
                    Teléfono
                    <input
                      name="phone"
                      required
                      minLength={6}
                      placeholder="600 000 000"
                    />
                  </label>
                  <label>
                    Ciudad de reparto
                    <input name="city" required defaultValue="Xàtiva" />
                  </label>
                  <label>
                    Vehículo
                    <select name="vehicle" defaultValue="electric_scooter">
                      <option value="bike">Bicicleta normal</option>
                      <option value="electric_bike">Bicicleta eléctrica</option>
                      <option value="electric_scooter">
                        Patinete eléctrico
                      </option>
                      <option value="motorcycle">Moto</option>
                      <option value="car">Coche</option>
                    </select>
                  </label>
                  <label>
                    Disponibilidad
                    <input
                      name="availability"
                      required
                      placeholder="Tardes y fines de semana"
                    />
                  </label>
                  <label>
                    Número de la Seguridad Social
                    <input
                      name="socialSecurityNumber"
                      required
                      placeholder="Número de afiliación"
                    />
                  </label>
                  <fieldset className="document-upload-group">
                    <legend>Expediente documental obligatorio</legend>
                    <p className="form-hint">
                      La identidad deberá verificarse mediante escaneo online.
                      Fleet/Admin revisarán el expediente antes de activar la
                      cuenta. Adjunta exclusivamente archivos PDF legibles.
                    </p>
                    <label>
                      DNI/NIE
                      <input
                        name="document_identity"
                        type="file"
                        accept=".pdf,application/pdf"
                        required
                      />
                    </label>
                    <label>
                      Certificado de titularidad bancaria
                      <input
                        name="document_bank_certificate"
                        type="file"
                        accept=".pdf,application/pdf"
                        required
                      />
                    </label>
                    <label>
                      Permiso de conducir (moto/coche)
                      <input
                        name="document_driving_license"
                        type="file"
                        accept=".pdf,application/pdf"
                      />
                    </label>
                    <label>
                      Seguro obligatorio (moto/coche)
                      <input
                        name="document_insurance"
                        type="file"
                        accept=".pdf,application/pdf"
                      />
                    </label>
                    <label>
                      Ficha técnica (moto/coche)
                      <input
                        name="document_vehicle_technical_sheet"
                        type="file"
                        accept=".pdf,application/pdf"
                      />
                    </label>
                    <label>
                      Permiso de circulación (moto/coche)
                      <input
                        name="document_vehicle_registration"
                        type="file"
                        accept=".pdf,application/pdf"
                      />
                    </label>
                    <label>
                      Declaración responsable del patinete
                      <input
                        name="document_scooter_declaration"
                        type="file"
                        accept=".pdf,application/pdf"
                      />
                    </label>
                    <label>
                      Certificado DGT MVP homologado
                      <input
                        name="document_dgt_mvp"
                        type="file"
                        accept=".pdf,application/pdf"
                      />
                    </label>
                  </fieldset>
                  <label className="check-row">
                    <input
                      name="safetyDeclarationAccepted"
                      type="checkbox"
                      required
                    />{" "}
                    Confirmo que frenos, luces y elementos de seguridad cumplen
                    la normativa vigente de circulación.
                  </label>
                  <input
                    name="website"
                    className="honeypot"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                  />
                  <p className="form-hint">
                    Los campos de vehículo se validan en el servidor según la
                    opción elegida.
                  </p>
                  {applicationStatus === "error" && (
                    <p className="form-error">{error}</p>
                  )}
                  {applicationStatus === "sent" && (
                    <p className="form-success">
                      Solicitud recibida. El equipo de Operaciones se pondrá en contacto
                      contigo.
                    </p>
                  )}
                  <button
                    className="primary-button form-submit"
                    disabled={applicationStatus === "sending"}
                  >
                    {applicationStatus === "sending"
                      ? "Enviando…"
                      : "Enviar solicitud"}
                    <ChevronRight size={17} />
                  </button>
                </form>
              </div>
            </section>
          ) : (
            <>
              {section === "Incentivos" && <RiderIncentivesPanel token={apiToken} riderId={riderId} />}
              {section === "Ofertas" && (
                <section className="feature-section">
                  <FeatureHeading
                    eyebrow="PIKI · OFERTAS"
                    title="Repartos asignados a tu jornada."
                    lead="Las ofertas se asignan automáticamente. Pulsa Aceptar reparto para asumirla; si hay una incidencia, contacta con Soporte PIKI."
                    icon={<Bell />}
                  />
                  <div className="delivery-list">
                    {offers
                      .filter((offer) => offer.assignmentState === "offered")
                      .map((offer) => (
                        <article className="assignment-card assignment-card-incoming" key={offer._id}>
                          <div className="assignment-card-topline">
                            <span className="assignment-kicker"><Bell size={14} /> NUEVO PEDIDO</span>
                            <span className="assignment-countdown"><Clock3 size={14} /> 60 s</span>
                          </div>
                          <div className="assignment-card-body">
                            <div className="assignment-order-heading">
                              <div>
                                <span className="assignment-order-code">{offer.displayCode || offer.publicCode || "Pedido PIKI"}</span>
                                <h2>{offer.restaurant?.name || "Establecimiento PIKI"}</h2>
                              </div>
                              <span className="assignment-alert-dot" aria-label="Alerta de nueva asignación" />
                            </div>
                            <div className="assignment-facts">
                              <span><MapPinned size={16} /><b>Recogida</b> {offer.restaurant?.etaMinutes?.[0] || 4} min</span>
                              <span><MapPinned size={16} /><b>Entrega</b> {offer.etaMinutes || 18} min</span>
                              <span><CreditCard size={16} /><b>Ganancia</b> {formatOrderMoney(offer.deliveryFeeCents || offer.totalCents)}</span>
                            </div>
                            <p className="assignment-address">{offer.restaurant?.address || "Dirección del Partner protegida"}</p>
                            <p className="assignment-items">{(offer.items || []).map((item) => `${item.quantity || 1}× ${item.name || "Producto"}`).join(" · ") || "Pedido preparado para recoger"}</p>
                          </div>
                          <div className="assignment-card-actions">
                            <a className="assignment-secondary-action" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(offer.restaurant?.address || offer.restaurant?.name || "")}`} target="_blank" rel="noreferrer"><MapPinned size={16} /> Ver mapa</a>
                            <button className="assignment-primary-action" disabled={orderActionBusy} onClick={() => void acceptRiderOfferAction(offer._id)}>ACEPTAR PEDIDO <ChevronRight size={18} /></button>
                          </div>
                          <p className="assignment-helper">La alerta sonora seguirá activa mientras esta oferta esté pendiente.</p>
                        </article>
                      ))}
                    {!offers.some(
                      (offer) => offer.assignmentState === "offered",
                    ) && (
                      <p className="empty-copy">
                        No tienes nuevas ofertas. Mantén tu jornada activa para
                        recibirlas.
                      </p>
                    )}
                  </div>
                </section>
              )}
              {section === "Entregas" && (
                <section className="feature-section">
                  <FeatureHeading
                    eyebrow="PIKI · ENTREGAS ACTIVAS"
                    title="Cada paso queda registrado."
                    lead="Retira el pedido en el Partner, inicia la ruta hacia el cliente y valida la entrega con su código."
                    icon={<ClipboardList />}
                  />
                  <div className="delivery-list">
                    {offers
                      .filter((offer) => offer.assignmentState === "assigned")
                      .map((offer) => (
                        <article className="assignment-card assignment-card-active" key={offer._id}>
                          <div className="assignment-card-topline">
                            <span className="assignment-kicker"><ClipboardList size={14} /> PEDIDO ACTIVO</span>
                            <span className="assignment-order-code">{offer.displayCode || offer.publicCode || "Pedido PIKI"}</span>
                          </div>
                          <div className="assignment-card-body">
                            <div className="assignment-order-heading">
                              <div>
                                <span className="assignment-phase">{isPickupPhase(offer.status) ? "Recogida en Partner" : offer.status === "picked_up" ? "Recogida confirmada" : "En ruta hacia el cliente"}</span>
                                <h2>{isPickupPhase(offer.status) ? offer.restaurant?.name || "Establecimiento PIKI" : offer.customerName || "Cliente PIKI"}</h2>
                              </div>
                              <span className="assignment-live-pill">EN DIRECTO</span>
                            </div>
                            <div className="assignment-stepper" aria-label="Progreso del pedido">
                              {["Recoger", "En camino", "Entregado"].map((label, index) => <span className={index <= orderStepIndex(offer.status) ? "is-done" : ""} key={label}><i>{index + 1}</i>{label}</span>)}
                            </div>
                            <div className="assignment-facts">
                              <span><MapPinned size={16} /><b>Destino</b> {offer.etaMinutes || 18} min</span>
                              <span><CreditCard size={16} /><b>Cobro</b> {offer.paymentMethod === "cash" ? formatOrderMoney(offer.totalCents) : "Pagado online"}</span>
                            </div>
                            <p className="assignment-address">{orderDestination(offer)}</p>
                            <p className="assignment-items">{(offer.items || []).map((item) => `${item.quantity || 1}× ${item.name || "Producto"}`).join(" · ") || "Pedido en seguimiento"}</p>
                          </div>
                          <div className="assignment-card-actions">
                            <a className="assignment-secondary-action" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(orderDestination(offer))}`} target="_blank" rel="noreferrer"><MapPinned size={16} /> ABRIR NAVEGACIÓN</a>
                            {offer.status === "ready_for_pickup" && <button className="assignment-primary-action" disabled={orderActionBusy} onClick={() => void confirmPickup(offer._id)}>CONFIRMAR RECOGIDA · GPS</button>}
                            {offer.status === "picked_up" && <button className="assignment-primary-action" onClick={() => void offerAction(offer._id, "on_the_way")}>INICIAR RUTA</button>}
                            {offer.status === "on_the_way" && <button className="assignment-primary-action" onClick={() => { const code = window.prompt("Introduce el PIN o pega el enlace QR que muestra el Customer para confirmar la entrega."); if (code?.trim()) void confirmDelivery(offer._id, code.trim()); }}>VALIDAR QR/PIN <ShieldCheck size={17} /></button>}
                          </div>
                          <p className="assignment-helper">{offer.paymentMethod === "cash" ? `Cobro al entregar: ${formatOrderMoney(offer.totalCents)}` : "Pedido pagado online · no cobres al cliente"}</p>
                        </article>
                      ))}
                    {!offers.some(
                      (offer) => offer.assignmentState === "assigned",
                    ) && (
                      <p className="empty-copy">No tienes entregas activas.</p>
                    )}
                  </div>
                </section>
              )}
              {section === "Horarios" && (
                <section className="feature-section">
                  <FeatureHeading
                    eyebrow="PIKI · HORARIOS"
                    title="Tus turnos, claros antes de salir."
                    lead="El Fleet de tu zona asigna los turnos. Solo tú puedes consultar tus horas y días disponibles."
                    icon={<CalendarDays />}
                  />
                  <div className="shift-toolbar">
                    <div>
                      <strong>Calendario de jornada</strong>
                      <span>Asignaciones de Fleet · hora oficial de España · sincronización automática y en tiempo real</span>
                    </div>
                    <span className="zone-chip">Zona Xàtiva</span>
                  </div>
                  <div className="schedule-grid">
                    {activeShifts.map((shift) => (
                      <article
                        className={`schedule-day ${shift.status}`}
                        key={shift.day}
                      >
                        <span>{shift.day}</span>
                        <strong>{shift.date || "Sin fecha"}</strong>
                        {shift.start ? (
                          <>
                            <b>
                              {shift.start} – {shift.end}
                            </b>
                            <small>{shift.zone || "Zona asignada"}</small>
                          </>
                        ) : (
                          <small>Sin turno asignado</small>
                        )}
                      </article>
                    ))}
                  </div>
                  <div className="shift-action">
                    <Clock3 size={20} />
                    <div>
                      <strong>
                        {shiftActive ? "Jornada activa" : "Jornada cerrada"}
                      </strong>
                      <span>
                        {shiftActive
                          ? "Puedes recibir ofertas en tu zona."
                          : currentShift.eligible
                            ? "Tu turno está abierto: puedes iniciar ahora."
                            : "No hay un turno disponible en esta franja. Revisa los horarios o contacta con Fleet."}
                      </span>
                    </div>
                    {!shiftActive && <button
                      className="primary-button rider-shift-start-button"
                      disabled={shiftBusy || !currentShift.eligible}
                      onClick={() => void toggleShift()}
                    >
                      <Power size={18} />
                      {shiftBusy ? "VALIDANDO…" : currentShift.eligible ? "INICIAR JORNADA" : "FUERA DE HORARIO"}
                    </button>}
                  </div>
                </section>
              )}
              {section === "Cartera" && (
                <section className="feature-section">
                  <FeatureHeading
                    eyebrow="PIKI · CARTERA"
                    title="Tu dinero, siempre bajo control."
                    lead="Consulta los cobros en efectivo registrados y la información disponible de tu cartera."
                    icon={<WalletCards />}
                  />
                  <aside className="wallet-payment-calendar" aria-label="Calendario planificado de pagos">
                    <CalendarDays aria-hidden="true" />
                    <div>
                      <strong>Calendario planificado de pagos: días 1 y 15</strong>
                      <p>La política prevista contempla revisiones quincenales. La fecha, el importe y el estado de cada liquidación solo se mostrarán cuando estén confirmados por el sistema.</p>
                    </div>
                  </aside>
                  <div className="wallet-card">
                    <div>
                      <span>Dinero en mano disponible</span>
                      <strong>
                        {(cashWallet.availableCents / 100).toLocaleString(
                          "es-ES",
                          { style: "currency", currency: "EUR" },
                        )}
                      </strong>
                      <small>
                        {cashWallet.collectedEntries
                          ? `${cashWallet.collectedEntries} cobro(s) en efectivo registrados · pendiente de liquidar`
                          : "Los cobros en efectivo aparecerán aquí al cerrar una entrega."}
                      </small>
                    </div>
                    <WalletCards size={42} />
                  </div>
                  <div className="wallet-grid">
                    <article className="wallet-stat">
                      <ArrowUpRight />
                      <span>Ingresos de entregas</span>
                      <strong>€ —</strong>
                    </article>
                    <article className="wallet-stat">
                      <ArrowDownLeft />
                      <span>Propinas e incentivos</span>
                      <strong>€ —</strong>
                    </article>
                    <article className="wallet-stat">
                      <CreditCard />
                      <span>Próximo pago</span>
                      <strong>Pendiente</strong>
                    </article>
                  </div>
                  <div className="empty-card">
                    <div className="empty-card-top">
                      <span>MOVIMIENTOS</span>
                      <FileText size={18} />
                    </div>
                    <h2>Aún no hay movimientos.</h2>
                    <p>
                      Las liquidaciones aparecerán aquí después de completar
                      entregas y superar la validación operativa.
                    </p>
                  </div>
                </section>
              )}
              {section === "Estadísticas" && (
                <section className="feature-section">
                  <FeatureHeading
                    eyebrow="PIKI · ESTADÍSTICAS"
                    title="Mejora con cada entrega."
                    lead="Solo tus entregas: aceptadas, completadas, canceladas y calidad."
                    icon={<Activity />}
                  />
                  <div className="stats-grid">
                    <StatCard
                      label="Completadas"
                      value={stats.completed}
                      tone="positive"
                    />
                    <StatCard
                      label="Canceladas"
                      value={stats.cancelled}
                      tone="negative"
                    />
                    <StatCard
                      label="Aceptadas"
                      value={stats.accepted}
                      tone="neutral"
                    />
                    <StatCard
                      label="Valoración"
                      value={stats.rating}
                      tone="positive"
                    />
                  </div>
                  <div className="stats-panel">
                    <div className="stats-panel-head">
                      <div>
                        <span>ENTREGAS POR DÍA</span>
                        <h2>Tu historial reciente</h2>
                      </div>
                      <Zap size={22} />
                    </div>
                    <div className="daily-deliveries">
                      {stats.dailyDeliveries.length ? (
                        stats.dailyDeliveries.map((day) => (
                          <div className="daily-delivery-row" key={day.date}>
                            <span>{day.date}</span>
                            <strong>{day.completed}</strong>
                            <small>
                              {day.completed === 1
                                ? "entrega completada"
                                : "entregas completadas"}
                            </small>
                          </div>
                        ))
                      ) : (
                        <p className="empty-copy">
                          Todavía no hay entregas registradas.
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              )}
              {section === "Soporte" && (
                <section className="feature-section">
                  <FeatureHeading
                    eyebrow="PIKI · CENTRO DE AYUDA"
                    title="Estamos contigo en ruta."
                    lead="Cada consulta tiene su propio flujo para que Operaciones reciba el contexto correcto desde el primer mensaje."
                    icon={<LifeBuoy />}
                  />
                  <div className="support-quick-actions">
                    <button
                      className="whatsapp-help-button"
                      onClick={() =>
                        openWhatsApp(
                          "Centro de ayuda",
                          "Necesito ayuda general",
                        )
                      }
                    >
                      <MessageCircle size={18} /> Abrir centro de ayuda en
                      WhatsApp
                    </button>
                    <span>
                      Atención guiada por ManyChat · WhatsApp Business
                    </span>
                  </div>
                  <div className="support-grid">
                    {supportTopics.map(({ id, title, text, icon: Icon }) => (
                      <SupportCard
                        key={id}
                        icon={<Icon />}
                        title={title}
                        text={text}
                        onClick={() => supportAction(id)}
                      />
                    ))}
                  </div>
                  {supportTopic && (
                    <SupportDetail
                      topicId={supportTopic}
                      onBack={() => setSupportTopic(null)}
                      onCreateTicket={createSupportTicket}
                      onWhatsApp={openWhatsApp}
                    />
                  )}
                  {supportTicketId ? (
                    <section className="support-ticket-resume" aria-label="Incidencia de soporte">
                      <div className="support-ticket-resume-icon"><MessageCircle size={21} /></div>
                      <div className="support-ticket-resume-copy">
                        <span>CHAT OPERATIVO · {supportTicketStatus || "ABIERTO"}</span>
                        <h2>{supportTicketNumber || "Incidencia en curso"}</h2>
                        <p>{supportAgentName ? `Agente: ${supportAgentName}` : "Soporte recibirá tu reporte y responderá en esta conversación."}</p>
                        <p>{supportChatOrderLabel || "Conversación vinculada a tu incidencia"}</p>
                      </div>
                      <div className="support-ticket-resume-actions">
                        <button type="button" className="primary-button" onClick={() => { setSupportChatError(""); setSupportChatOpen(true); }}>
                          {supportTicketStatus === "closed" || supportTicketStatus === "resolved" ? "Ver conversación" : "Abrir chat"}
                        </button>
                        {(supportTicketStatus === "closed" || supportTicketStatus === "resolved") && (
                          <button type="button" className="secondary-button" onClick={() => { setSupportTicketId(""); setSupportTicketNumber(""); setSupportTicketStatus(""); setSupportAgentName(""); setSupportChatMessages([]); setSupportChatDraft(""); setSupportChatOrderLabel(""); setSupportChatError(""); setSupportFormMessage(""); }}>
                            Nueva incidencia
                          </button>
                        )}
                      </div>
                    </section>
                  ) : (
                    <form className="support-ticket-form" onSubmit={submitSupportTicket}>
                      <div><span>INCIDENCIA OPERATIVA</span><h2>Enviar caso a Soporte PIKI</h2><p>{activeOrder ? `Se adjuntará automáticamente el pedido ${visibleOrderReference(activeOrder.publicCode, activeOrder._id)}, el cliente, la dirección, el comercio, los artículos y el importe.` : "Puedes enviar una consulta general o seleccionar un pedido activo para adjuntar todo su contexto."}</p></div>
                      <div className="support-ticket-fields"><input required value={supportForm.subject} onChange={(event) => setSupportForm({ ...supportForm, subject: event.target.value })} placeholder="Asunto de la incidencia" /><select value={supportForm.priority} onChange={(event) => setSupportForm({ ...supportForm, priority: event.target.value })}><option value="urgent">Urgente · pedido bloqueado</option><option value="high">Alta</option><option value="normal">Normal</option></select><textarea required rows={4} value={supportForm.description} onChange={(event) => setSupportForm({ ...supportForm, description: event.target.value })} placeholder="Explica qué ocurre, dónde está el pedido y qué necesitas de Soporte…" /></div><button className="primary-button" disabled={supportFormBusy}>{supportFormBusy ? "Enviando…" : "Enviar incidencia vinculada al pedido"}</button>{supportFormMessage && <p className="support-form-message" role="alert">{supportFormMessage}</p>}
                    </form>
                  )}
                  <RiderSupportChatDialog
                    open={supportChatOpen && Boolean(supportTicketId)}
                    onClose={closeSupportChat}
                    agentName={supportAgentName}
                    ticketNumber={supportTicketNumber}
                    status={supportTicketStatus || "open"}
                    orderLabel={supportChatOrderLabel}
                    messages={supportChatMessages}
                    peerTyping={supportPeerTyping}
                    draft={supportChatDraft}
                    onDraftChange={setSupportChatDraft}
                    onSend={sendSupportChatMessage}
                    busy={supportChatBusy}
                    error={supportChatError}
                  />
                  <div className="faq-panel">
                    <div className="faq-panel-heading">
                      <div>
                        <span>PREGUNTAS FRECUENTES</span>
                        <h2>Respuestas rápidas</h2>
                      </div>
                      <CircleHelp size={22} />
                    </div>
                    {supportFaqs.map(([question, answer], index) => (
                      <div className="faq-row" key={question}>
                        <button
                          onClick={() =>
                            setFaqOpen(faqOpen === index ? null : index)
                          }
                        >
                          <span>{question}</span>
                          {faqOpen === index ? (
                            <ChevronDown size={17} />
                          ) : (
                            <ChevronRight size={17} />
                          )}
                        </button>
                        {faqOpen === index && <p>{answer}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {section === "Cuenta" && (
                <section className="feature-section rider-account-section" aria-label="Cuenta Rider">
                  <FeatureHeading
                    eyebrow="PIKI · CUENTA"
                    title="Tu perfil y acceso operativo."
                    lead="Consulta tus datos de Rider y accede a las acciones personales. La jornada y el mapa solo están disponibles desde Inicio."
                    icon={<Settings />}
                  />
                  <div className="rider-account-grid">
                    <article className="rider-account-card">
                      <span className="rider-account-label">PERFIL RIDER</span>
                      <h2>{riderProfile.name || "Tu cuenta Rider"}</h2>
                      <dl>
                        <div><dt>Email</dt><dd>{riderProfile.email || "Pendiente de sincronizar"}</dd></div>
                        <div><dt>Código Rider</dt><dd>{riderProfile.riderCode || "Pendiente de asignación"}</dd></div>
                        <div><dt>Estado</dt><dd><i className={shiftActive ? "is-online" : ""} /> {shiftActive ? "En jornada" : "Fuera de jornada"}</dd></div>
                      </dl>
                    </article>
                    <article className="rider-account-card rider-account-actions">
                      <ShieldCheck size={26} aria-hidden="true" />
                      <h2>Acciones personales</h2>
                      <p>Revisa tus turnos, consulta tu documentación con Operaciones o abre una solicitud de soporte.</p>
                      <div>
                        <button type="button" className="primary-button" onClick={() => showSection("Horarios")}><CalendarDays size={16} /> Ver horarios</button>
                        <button type="button" className="secondary-button" onClick={() => showSection("Soporte")}><LifeBuoy size={16} /> Contactar soporte</button>
                      </div>
                    </article>
                  </div>
                </section>
              )}
              {shouldShowOperationalMap(section) && (
                <section className="rider-home-map" aria-label="Mapa y estado de jornada">
                  <div className="rider-home-map-canvas">
                    <LiveGoogleMap
                      token={apiToken}
                      riderId={riderId}
                      active={shouldTrackLocationOnOperationalMap(section, shiftActive)}
                      nativeTracking={nativeTracking}
                      onError={handleApiError}
                    />
                  </div>
                  {!nativeTracking && shiftActive && <OperationalActivation
                    token={apiToken}
                    riderId={riderId}
                    active={shiftActive}
                    playTestSound={async () => {
                      primeRiderOrderAudio(audioContextRef);
                      playRiderShiftStart();
                    }}
                    onError={handleApiError}
                  />}
                  <div className="rider-home-control">
                    <div>
                      <p className="rider-home-eyebrow">JORNADA DE REPARTO</p>
                      <h1>{shiftActive ? "Estás en línea" : "No estás disponible"}</h1>
                      <p>{shiftActive ? "Tu ubicación está activa y recibirás ofertas en tu zona." : "Activa tu jornada para aparecer disponible y recibir repartos."}</p>
                    </div>
                    {!shiftActive && <button
                      className="rider-home-toggle"
                      type="button"
                      disabled={shiftBusy || !currentShift.eligible}
                      onClick={() => void toggleShift()}
                    >
                      {shiftBusy ? "Comprobando…" : currentShift.eligible ? "Empezar sesión" : "Fuera de horario"}
                    </button>}
                    <div className="rider-home-meta"><span><i className={shiftActive ? "is-online" : ""} /> {shiftActive ? "Disponible hasta el fin del slot" : "No disponible para asignaciones"}</span><button type="button" onClick={() => showSection("Horarios")}>Ver horarios</button></div>
                  </div>
                </section>
              )}
            </>
          )}
        </section>
        {startConsentOpen && <section className="rider-start-consent" role="dialog" aria-modal="true" aria-label="Antes de empezar">
          <button type="button" className="rider-consent-close" onClick={() => setStartConsentOpen(false)} aria-label="Cerrar"><X size={30} /></button>
          <div className="rider-consent-content"><h1>Antes de empezar</h1><p>Recopilaremos y procesaremos tus datos de ubicación en tiempo real para ofrecerte entregas disponibles.</p><p>Revisa y acepta las políticas y los requisitos gubernamentales que se detallan a continuación.</p><ul><li><strong>He leído y entendido la declaración de privacidad</strong><button type="button" onClick={() => { setStartConsentOpen(false); showSection("Soporte"); }}>Más información ↗</button></li><li><strong>Al hacer clic en ACEPTAR Y EMPEZAR, confirmo que estoy usando y usaré el Equipo de Protección Individual (EPI) requerido durante mi trabajo.</strong></li></ul></div>
          <button type="button" className="rider-consent-accept" onClick={() => void toggleShift()}>Aceptar y empezar</button>
        </section>}
      </main>
    </div>
  );
}

function FeatureHeading({
  eyebrow,
  title,
  lead,
  icon,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="feature-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
      </div>
      <div className="feature-icon">{icon}</div>
    </div>
  );
}
function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: string;
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>
        {value === 0 ? "Sin actividad registrada" : "Periodo actual"}
      </small>
    </article>
  );
}
function SupportCard({
  icon,
  title,
  text,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button className="support-card" onClick={onClick}>
      <span className="support-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <ChevronRight size={18} />
    </button>
  );
}
function SupportDetail({
  topicId,
  onBack,
  onCreateTicket,
  onWhatsApp,
}: {
  topicId: string;
  onBack: () => void;
  onCreateTicket: (topic: string, option: string) => void;
  onWhatsApp: (topic: string, option: string) => void;
}) {
  const topic = supportTopics.find((item) => item.id === topicId);
  if (!topic) return null;
  return (
    <section className="support-detail-panel">
      <div className="support-detail-heading">
        <div>
          <span>PIKI · {topic.title.toUpperCase()}</span>
          <h2>¿Qué necesitas resolver?</h2>
          <p>
            Selecciona una opción para abrir el flujo específico en el centro de
            ayuda.
          </p>
        </div>
        <button className="secondary-button" onClick={onBack}>
          Volver
        </button>
      </div>
      <div className="support-option-grid">
        {topic.options.map((option) => (
          <div
            className="support-option"
            key={option}
          >
            <span className="support-option-label"><LifeBuoy size={17} />{option}</span>
            <button type="button" className="primary-button" onClick={() => onCreateTicket(topicId, option)}>
              Enviar a Soporte
            </button>
            <button type="button" className="secondary-button" onClick={() => onWhatsApp(topic.title, option)}>
              <MessageCircle size={16} /> WhatsApp
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
export default App;
