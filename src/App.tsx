import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
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
import NotificationCenter from "./NotificationCenter";
import EmployeeAuthGate from "./EmployeeAuthGate";
import LiveGoogleMap from "./components/LiveGoogleMap";
import ActiveShiftScreen from "./components/ActiveShiftScreen";
import RiderIncentivesPanel from "./components/RiderIncentivesPanel";
import LocationPermissionGate from "./components/LocationPermissionGate";
import { connectPikiRealtime } from "./realtime";
import {
  playRiderOrderAlert,
  primeRiderOrderAudio,
  type RiderAlertAudioContext,
} from "./orderAlert";
import {
  createRiderSupportTicket,
  loadMobilityAdvice,
  loadRiderOrderMessages,
  sendRiderOrderMessage,
  type RiderOrderMessage,
} from "./integrations/piki-api";
import type { CurrentShift, RiderOffer, Shift } from "./types/rider";
import { orderRiderQueue } from "./orderQueue";
import {
  clearStoredToken,
  getStoredToken,
  storeToken,
  markStoredTokenValidated,
} from "./authStorage";
import { requiresRiderAuthentication } from "./apiAuthPolicy";

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
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
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
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    sha256,
    contentBase64: btoa(binary),
  };
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
  ["Mapa", MapPinned],
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
function madridParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}
function shiftCountdown(now: { date: string; time: string }, shift?: Shift | null) {
  if (!shift?.date || !shift.start) return null;
  const [year, month, day] = now.date.split("-").map(Number);
  const [targetYear, targetMonth, targetDay] = shift.date.split("-").map(Number);
  const [nowHour, nowMinute] = now.time.split(":").map(Number);
  const [startHour, startMinute] = shift.start.split(":").map(Number);
  const dayDelta = (Date.UTC(targetYear, targetMonth - 1, targetDay) - Date.UTC(year, month - 1, day)) / 86_400_000;
  const minutes = dayDelta * 1440 + startHour * 60 + startMinute - (nowHour * 60 + nowMinute);
  if (minutes <= 0) return "Empieza ahora";
  if (minutes < 60) return `Empezará en menos de ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `Empezará en ${hours} h${remaining ? ` ${remaining} min` : ""}`;
}

function App() {
  const [section, setSection] = useState(getInitialRiderSection);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("checking");
  const [authRequired, setAuthRequired] = useState(false);
  const [apiToken, setApiToken] = useState(() => getStoredToken());
  const [applicationStatus, setApplicationStatus] =
    useState<ApplicationStatus>("idle");
  const [error, setError] = useState("");
  const [shiftActive, setShiftActive] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [startConsentOpen, setStartConsentOpen] = useState(false);
  const [showOperations, setShowOperations] = useState(false);
  const [startedShiftNotice, setStartedShiftNotice] = useState(false);
  const [riderId, setRiderId] = useState("");
  const [currentShift, setCurrentShift] = useState<CurrentShift>({
    eligible: false,
  });
  const [serverClockAnchor, setServerClockAnchor] = useState<{ serverMs: number; clientMs: number } | null>(null);
  const [clockTick, setClockTick] = useState(0);
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
  const [orderMessages, setOrderMessages] = useState<RiderOrderMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [messageBusy, setMessageBusy] = useState(false);
  const [supportTopic, setSupportTopic] = useState<string | null>(null);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [supportForm, setSupportForm] = useState({ subject: "", description: "", priority: "high" });
  const [supportFormBusy, setSupportFormBusy] = useState(false);
  const [supportFormMessage, setSupportFormMessage] = useState("");
  const [supportTicketId, setSupportTicketId] = useState("");
  const [supportTicketStatus, setSupportTicketStatus] = useState("");
  const [supportAgentName, setSupportAgentName] = useState("");
  const [supportChatMessages, setSupportChatMessages] = useState<Array<{ _id?: string; senderRole: string; senderName?: string; body: string; createdAt: string }>>([]);
  const [supportChatDraft, setSupportChatDraft] = useState("");
  const [supportChatBusy, setSupportChatBusy] = useState(false);
  const [supportPeerTyping, setSupportPeerTyping] = useState(false);
  const knownOfferIdsRef = useRef<Set<string> | null>(null);
  const lastOfferAtRef = useRef(0);
  const lastMobilityAlertRef = useRef("");
  const audioContextRef = useRef<RiderAlertAudioContext | null>(null);
  const assignedOrderRef = useRef(false);
  const riderRefreshInFlightRef = useRef(false);
  const activeOrder = orderRiderQueue(offers.filter((offer) => offer.assignmentState === "assigned"))[0];

  const playAssignmentAlert = useCallback(() => {
    playRiderOrderAlert(audioContextRef);
  }, []);

  const loadRiderData = useCallback(async () => {
    if (!apiToken || riderRefreshInFlightRef.current) return;
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
        rider?: { id?: string; status?: string };
      };
      const id = String(sessionData.rider?.id || "");
      if (!id) return;
      markStoredTokenValidated();
      setRiderId(id);
      const [slotResponse, statsResponse, shiftResponse, cashResponse] =
        await Promise.all([
          fetch(`${apiOrigin}/api/v1/riders/${id}/slots`, { headers }),
          fetch(`${apiOrigin}/api/v1/riders/statistics`, { headers }),
          fetch(`${apiOrigin}/api/v1/riders/${id}/shift`, { headers }),
          fetch(`${apiOrigin}/api/v1/riders/${id}/cash-wallet`, { headers }),
        ]);
      if (slotResponse.ok) {
        const data = (await slotResponse.json()) as { slots?: Shift[] };
        setShifts(Array.isArray(data.slots) ? data.slots : []);
      }
      if (shiftResponse.ok) {
        const data = (await shiftResponse.json()) as CurrentShift;
        setCurrentShift(data);
        const serverIso = data.serverClock?.iso || data.now?.iso;
        if (serverIso) setServerClockAnchor({ serverMs: Date.parse(serverIso), clientMs: Date.now() });
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
    } catch {
      /* Panels remain usable while the API is unavailable. */
    } finally {
      riderRefreshInFlightRef.current = false;
    }
  }, [apiToken]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const authoritativeNow = useMemo(() => {
    void clockTick;
    const timestamp = serverClockAnchor ? serverClockAnchor.serverMs + (Date.now() - serverClockAnchor.clientMs) : Date.now();
    const parts = madridParts(timestamp);
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }, [clockTick, serverClockAnchor]);
  const reservedShiftCountdown = shiftCountdown(authoritativeNow, currentShift.shift);

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
    // The API is authoritative for Europe/Madrid date/time and slot eligibility.
    // Refresh while the app stays open so a shift starts/ends without relying
    // on the rider's device clock or a manual refresh.
    const timer = window.setInterval(() => { void loadRiderData(); }, 30_000);
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
    if (!apiToken || !riderId || !shiftActive) return;
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
        if (event.type !== "order.rider_offer") return;
        void fetch(`${apiOrigin}/api/v1/riders/${riderId}/offers`, {
          headers: authHeaders(apiToken),
        })
          .then(async (response) => {
            if (!response.ok) return;
            const data = (await response.json()) as { offers?: RiderOffer[] };
            setOffers(Array.isArray(data.offers) ? data.offers : []);
            lastOfferAtRef.current = Date.now();
            setOffersError("");
            playAssignmentAlert();
            setToast(
              "Nueva oferta de reparto. Revísala en la pantalla de jornada.",
            );
          })
          .catch(() => undefined);
      },
    });
  }, [apiToken, riderId, shiftActive, playAssignmentAlert]);
  useEffect(() => {
    const activeOrder = orderRiderQueue(offers.filter((offer) => offer.assignmentState === "assigned"))[0];
    if (!apiToken || !riderId || !activeOrder) {
      // oxlint-disable-next-line react/set-state-in-effect
      setOrderMessages([]);
      return;
    }
    let disposed = false;
    const pollMessages = async () => {
      try {
        const messages = await loadRiderOrderMessages(
          apiToken,
          riderId,
          activeOrder._id,
        );
        if (!disposed) setOrderMessages(messages);
      } catch {
        /* el pedido puede cerrarse mientras se actualiza */
      }
    };
    void pollMessages();
    const timer = window.setInterval(pollMessages, 4000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [apiToken, riderId, offers]);
  async function submitOrderMessage(event: FormEvent) {
    event.preventDefault();
    const activeOrder = orderRiderQueue(offers.filter((offer) => offer.assignmentState === "assigned"))[0];
    const body = messageDraft.trim();
    if (!apiToken || !riderId || !activeOrder || !body || messageBusy) return;
    setMessageBusy(true);
    try {
      const message = await sendRiderOrderMessage(
        apiToken,
        riderId,
        activeOrder._id,
        body,
      );
      setOrderMessages((previous) => [...previous, message]);
      setMessageDraft("");
    } catch {
      setToast("No se pudo enviar el mensaje. Revisa la conexión.");
    } finally {
      setMessageBusy(false);
    }
  }
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
  }
  async function toggleShift() {
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
    const endpoint = shiftActive ? "stop" : "start";
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
        now?: { date: string; time: string };
      };
      if (!response.ok) {
        setToast(
          data.message ||
            "No puedes iniciar: no hay un turno reservado activo.",
        );
        return;
      }
      const nowActive = endpoint === "start";
      setShiftActive(nowActive);
      setStartedShiftNotice(nowActive);
      setCurrentShift((previous) => ({
        ...previous,
        eligible: !nowActive,
        selfStartAllowed: false,
        shift: data.shift ?? previous.shift,
      }));
      setShowOperations(false);
      if (!shiftActive) {
        const audio = primeRiderOrderAudio(audioContextRef);
        if (audio) {
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.frequency.value = 880;
          gain.gain.value = 0.12;
          oscillator.connect(gain);
          gain.connect(audio.destination);
          oscillator.start();
          oscillator.stop(audio.currentTime + 0.45);
        }
      }
      setToast(
        nowActive
          ? "Jornada iniciada. Aviso sonoro activado."
          : "Jornada finalizada. Buen trabajo.",
      );
      await loadRiderData();
    } catch {
      setToast("No se pudo validar el turno con la API.");
    } finally {
      setShiftBusy(false);
    }
  }
  async function offerAction(
    orderId: string,
    action: "picked_up" | "on_the_way",
  ) {
    if (orderActionBusy) return;
    setOrderActionBusy(true);
    try {
      const endpoint = `/api/v1/orders/${orderId}/transitions`;
      const body = {
        status: action,
        actorRole: "rider",
        reason:
          action === "picked_up"
            ? "Pedido recogido en el establecimiento"
            : "Ruta iniciada hacia el cliente",
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
      setToast(
        action === "picked_up"
          ? "Recogida confirmada. Ahora se muestra la tarjeta del cliente."
          : "Ruta iniciada. Confirma la entrega al llegar al cliente.",
      );
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
  async function pickupOrder(orderId: string) {
    await offerAction(orderId, "picked_up");
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
  async function confirmPickup(orderId: string, verificationCode?: string) {
    if (orderActionBusy) return;
    setOrderActionBusy(true);
    try {
      const response = await fetch(
        `${apiOrigin}/api/v1/riders/${riderId}/orders/${orderId}/confirm-pickup`,
        {
          method: "POST",
          headers: {
            ...authHeaders(apiToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pickupQr: verificationCode,
            pickupPin: verificationCode,
          }),
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
      setToast(
        data.message ||
          "Recogida confirmada. Ya puedes iniciar la ruta hacia el cliente.",
      );
      await loadRiderData();
    } catch {
      setToast(
        "No se pudo validar la recogida. Comprueba el código y vuelve a intentarlo.",
      );
      await loadRiderData();
    } finally {
      setOrderActionBusy(false);
    }
  }
  async function submitSupportTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiToken || !riderId || !supportForm.subject.trim() || !supportForm.description.trim()) return;
    setSupportFormBusy(true); setSupportFormMessage("");
    try {
      const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ subject: supportForm.subject.trim(), description: supportForm.description.trim(), priority: supportForm.priority, orderId: activeOrder?._id }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || "No se pudo enviar la incidencia.");
      setSupportForm({ subject: "", description: "", priority: "high" }); setSupportTicketId(String(data.ticket?.id || "")); setSupportFormMessage("Chat abierto. Un agente de soporte responderá aquí y te indicará los pasos a seguir.");
    } catch (error) { setSupportFormMessage(error instanceof Error ? error.message : "No se pudo enviar la incidencia."); } finally { setSupportFormBusy(false); }
  }
  const refreshSupportChat = useCallback(async () => {
    if (!apiToken || !riderId || !supportTicketId) return;
    try { const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets`, { headers: { ...authHeaders(apiToken), "X-PIKI-Surface": "rider" } }); if (!response.ok) return; const data = await response.json() as { tickets?: any[] }; const ticket = (data.tickets || []).find((item) => String(item._id) === supportTicketId); if (ticket) { setSupportTicketStatus(ticket.status || ""); setSupportAgentName(ticket.assignedTo?.name || ticket.messages?.find((message: any) => message.senderRole === "support")?.senderName || "Agente de soporte"); setSupportPeerTyping(Boolean(ticket.agentTypingAt && Date.now() - new Date(ticket.agentTypingAt).getTime() < 5000)); setSupportChatMessages(Array.isArray(ticket.messages) ? ticket.messages : []); } } catch { /* el chat conserva el último estado mientras vuelve la red */ }
  }, [apiToken, apiOrigin, riderId, supportTicketId]);
  useEffect(() => {
    if (!apiToken || !riderId || supportTicketId) return;
    void (async () => { try { const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets`, { headers: { ...authHeaders(apiToken), "X-PIKI-Surface": "rider" } }); if (!response.ok) return; const data = await response.json() as { tickets?: any[] }; const openTicket = (data.tickets || []).find((item) => !["closed", "resolved"].includes(item.status)); if (openTicket) setSupportTicketId(String(openTicket._id)); } catch { /* sin conexión, se reintentará al enviar una incidencia */ } })();
  }, [apiToken, apiOrigin, riderId, supportTicketId]);
  useEffect(() => { if (!supportTicketId) return; void refreshSupportChat(); const timer = window.setInterval(() => void refreshSupportChat(), 2000); return () => window.clearInterval(timer); }, [supportTicketId, refreshSupportChat]);
  useEffect(() => {
    if (!apiToken || !riderId || !supportTicketId || !supportChatDraft.trim() || ["closed", "resolved"].includes(supportTicketStatus)) return;
    const ping = () => void fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets/${supportTicketId}/typing`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ active: true }) }).catch(() => undefined);
    ping(); const timer = window.setInterval(ping, 1500);
    return () => { window.clearInterval(timer); void fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets/${supportTicketId}/typing`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ active: false }) }).catch(() => undefined); };
  }, [apiToken, apiOrigin, riderId, supportTicketId, supportChatDraft, supportTicketStatus]);
  async function sendSupportChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const body = supportChatDraft.trim(); if (!body || !apiToken || !riderId || !supportTicketId || supportChatBusy) return; setSupportChatBusy(true);
    try { const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets/${supportTicketId}/messages`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ body }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || data.error || "El chat está cerrado."); setSupportChatDraft(""); if (data.ticket?.messages) setSupportChatMessages(data.ticket.messages); } catch (error) { setSupportFormMessage(error instanceof Error ? error.message : "No se pudo enviar el mensaje."); } finally { setSupportChatBusy(false); }
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
      ? `Pedido ${activeOrder.displayCode || activeOrder.publicCode || activeOrder._id}. Estado: ${activeOrder.status}. Comercio: ${activeOrder.restaurant?.name || "no disponible"}. Dirección relacionada: ${activeOrder.status === "ready_for_pickup" || activeOrder.status === "preparing" ? activeOrder.restaurant?.address || "no disponible" : activeOrder.deliveryAddress || "no disponible"}.`
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
      setToast(`Incidencia ${ticket.ticketNumber || "creada"}. Soporte PIKI ya tiene el contexto.`);
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
      <LocationPermissionGate appLabel="Rider">
      <ActiveShiftScreen
        token={apiToken}
        riderId={riderId}
        currentShift={currentShift}
        offers={offers}
        offersLoading={offersLoading}
        offersError={offersError}
        startedShiftNotice={startedShiftNotice}
        toast={toast}
        onDismissStartNotice={() => setStartedShiftNotice(false)}
        onOpenOperations={() => setShowOperations(true)}
        onRefreshOffers={() => {
          setOffersError("");
          void loadRiderData();
        }}
        onPickupOrder={(orderId) => void pickupOrder(orderId)}
        actionBusy={orderActionBusy}
        onOfferAction={(orderId, action) => void offerAction(orderId, action)}
        onConfirmPickup={(orderId, verificationCode) =>
          void confirmPickup(orderId, verificationCode)
        }
        onConfirmDelivery={(orderId, deliveryQr) =>
          void confirmDelivery(orderId, deliveryQr)
        }
        onError={handleApiError}
      />
      </LocationPermissionGate>
    );
  return (
    <LocationPermissionGate appLabel="Rider">
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
            <NotificationCenter apiOrigin={apiOrigin} token={apiToken} surface="rider" />
            <button
              className="icon-button"
              onClick={() => showSection("Soporte")}
              aria-label="Abrir soporte"
            >
              <Headphones size={19} />
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
                  <strong>Cuenta Rider</strong>
                  <span>rrhh.milchollos@gmail.com</span>
                  <button onClick={() => showSection("Cuenta")}>
                    Ver mi cuenta
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <section className="page-content">
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
                  <p className="eyebrow">PIKI · FLEET</p>
                  <h1>Únete a la red de riders.</h1>
                  <p className="lead">
                    Solicita tu alta en PIKI. El equipo Fleet revisará tus
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
                  <h2>Revisión Fleet</h2>
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
                      cuenta.
                    </p>
                    <label>
                      DNI/NIE
                      <input
                        name="document_identity"
                        type="file"
                        accept="application/pdf,image/*"
                        required
                      />
                    </label>
                    <label>
                      Certificado de titularidad bancaria
                      <input
                        name="document_bank_certificate"
                        type="file"
                        accept="application/pdf,image/*"
                        required
                      />
                    </label>
                    <label>
                      Permiso de conducir (moto/coche)
                      <input
                        name="document_driving_license"
                        type="file"
                        accept="application/pdf,image/*"
                      />
                    </label>
                    <label>
                      Seguro obligatorio (moto/coche)
                      <input
                        name="document_insurance"
                        type="file"
                        accept="application/pdf,image/*"
                      />
                    </label>
                    <label>
                      Ficha técnica (moto/coche)
                      <input
                        name="document_vehicle_technical_sheet"
                        type="file"
                        accept="application/pdf,image/*"
                      />
                    </label>
                    <label>
                      Permiso de circulación (moto/coche)
                      <input
                        name="document_vehicle_registration"
                        type="file"
                        accept="application/pdf,image/*"
                      />
                    </label>
                    <label>
                      Declaración responsable del patinete
                      <input
                        name="document_scooter_declaration"
                        type="file"
                        accept="application/pdf,image/*"
                      />
                    </label>
                    <label>
                      Certificado DGT MVP homologado
                      <input
                        name="document_dgt_mvp"
                        type="file"
                        accept="application/pdf,image/*"
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
                      Solicitud recibida. El equipo Fleet se pondrá en contacto
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
                    lead="Los pedidos se asignan automáticamente. Si existe una incidencia, utiliza Soporte PIKI; no se rechazan desde la app."
                    icon={<Bell />}
                  />
                  <div className="delivery-list">
                    {offers
                      .filter((offer) => offer.assignmentState === "offered")
                      .map((offer) => (
                        <article className="delivery-card" key={offer._id}>
                          <div>
                            <span className="eyebrow">
                              {offer.assignmentState === "offered" ? "NUEVA OFERTA · " : "PEDIDO ASIGNADO · "}
                              {offer.displayCode || offer.publicCode}
                            </span>
                            <h2>
                              {offer.restaurant?.name || "Establecimiento PIKI"}
                            </h2>
                            <p>
                              {offer.restaurant?.address ||
                                "Dirección del establecimiento protegida"}
                            </p>
                            <p>
                              {offer.restaurant?.cuisine || "Restaurante"} ·{" "}
                              {(offer.items || [])
                                .map(
                                  (item) =>
                                    `${item.quantity || 1}× ${item.name || "Producto"}`,
                                )
                                .join(" · ")}
                            </p>
                            <small>
                              Pulsa «Confirmar recogida» cuando tengas físicamente el pedido.
                            </small>
                          </div>
                          <div className="delivery-actions">
                            <a
                              className="secondary-button"
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(offer.restaurant?.address || offer.restaurant?.name || "")}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <MapPinned size={16} /> Maps
                            </a>
                            <button className="primary-button" disabled={orderActionBusy} onClick={() => void pickupOrder(offer._id)}>
                              Confirmar recogida
                            </button>
                          </div>
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
                        <article className="delivery-card" key={offer._id}>
                          <div>
                            <span className="eyebrow">
                              {offer.displayCode || offer.publicCode} ·{" "}
                              {offer.status}
                            </span>
                            <h2>
                              {["pending", "accepted", "preparing", "ready_for_pickup"].includes(offer.status)
                                ? offer.restaurant?.name ||
                                  "Establecimiento PIKI"
                                : offer.customerName || "Cliente"}
                            </h2>
                            <p>
                              {["pending", "accepted", "preparing", "ready_for_pickup"].includes(offer.status)
                                ? offer.restaurant?.address ||
                                  "Dirección del establecimiento protegida"
                                : offer.deliveryAddress ||
                                  "Dirección del cliente"}
                            </p>
                            <p>
                              {(offer.items || [])
                                .map(
                                  (item) =>
                                    `${item.quantity || 1}× ${item.name || "Producto"}`,
                                )
                                .join(" · ")}
                            </p>
                          </div>
                          <div className="delivery-actions">
                            <a
                              className="secondary-button"
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(["pending", "accepted", "preparing", "ready_for_pickup"].includes(offer.status) ? offer.restaurant?.address || offer.restaurant?.name || "" : offer.deliveryAddress || "")}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <MapPinned size={16} /> Maps
                            </a>
                            {["pending", "accepted", "preparing", "ready_for_pickup"].includes(offer.status) && (
                              <>
                                <button
                                  className="primary-button"
                                  disabled={orderActionBusy}
                                  onClick={() =>
                                    void offerAction(offer._id, "picked_up")
                                  }
                                >
                                  Confirmar recogida
                                </button>
                              </>
                            )}
                            {offer.status === "picked_up" && (
                              <button
                                className="secondary-button"
                                onClick={() =>
                                  void offerAction(offer._id, "on_the_way")
                                }
                              >
                                Iniciar ruta
                              </button>
                            )}
                            {offer.status === "on_the_way" && (
                              <button
                                className="primary-button"
                                onClick={() => {
                                  const code = window.prompt(
                                    "Introduce el PIN o pega el enlace QR que muestra el Customer para confirmar la entrega.",
                                  );
                                  if (code?.trim())
                                    void confirmDelivery(
                                      offer._id,
                                      code.trim(),
                                    );
                                }}
                              >
                                Validar QR/PIN y confirmar{" "}
                                <ShieldCheck size={17} />
                              </button>
                            )}
                          </div>
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
                      <span>Asignaciones de Fleet · sincronización automática cada 30 segundos y al volver a abrir la app</span>
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
                    <button
                      className="primary-button rider-shift-start-button"
                      disabled={shiftBusy}
                      onClick={() => void toggleShift()}
                    >
                      <Power size={18} />
                      {shiftActive ? "FINALIZAR JORNADA" : "INICIAR JORNADA"}
                    </button>
                  </div>
                </section>
              )}
              {section === "Cartera" && (
                <section className="feature-section">
                  <FeatureHeading
                    eyebrow="PIKI · CARTERA"
                    title="Tu dinero, siempre bajo control."
                    lead="Consulta ingresos, incentivos, propinas y próximos pagos con trazabilidad."
                    icon={<WalletCards />}
                  />
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
              {section === "Mapa" && (
                <section className="feature-section">
                  <FeatureHeading
                    eyebrow="PIKI · GOOGLE MAPS EN VIVO"
                    title="Tu zona, tu posición, en tiempo real."
                    lead="Google Maps muestra tu ubicación GPS, las zonas operativas asignadas y sus delimitaciones reales. Debes conceder permiso de ubicación para publicar tu posición durante la jornada."
                    icon={<MapPinned />}
                  />
                  {apiToken && (
                    <LiveGoogleMap
                      token={apiToken}
                      riderId={riderId}
                      onError={handleApiError}
                    />
                  )}
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
                  <form className="support-ticket-form" onSubmit={submitSupportTicket}>
                    <div><span>INCIDENCIA OPERATIVA</span><h2>Enviar caso a Soporte PIKI</h2><p>{activeOrder ? `Se adjuntará automáticamente el pedido ${activeOrder.displayCode || activeOrder.publicCode || activeOrder._id.slice(-6)}, el cliente, la dirección, el comercio, los artículos y el importe.` : "Puedes enviar una consulta general o seleccionar un pedido activo para adjuntar todo su contexto."}</p></div>
                    <div className="support-ticket-fields"><input required value={supportForm.subject} onChange={(event) => setSupportForm({ ...supportForm, subject: event.target.value })} placeholder="Asunto de la incidencia" /><select value={supportForm.priority} onChange={(event) => setSupportForm({ ...supportForm, priority: event.target.value })}><option value="urgent">Urgente · pedido bloqueado</option><option value="high">Alta</option><option value="normal">Normal</option></select><textarea required rows={4} value={supportForm.description} onChange={(event) => setSupportForm({ ...supportForm, description: event.target.value })} placeholder="Explica qué ocurre, dónde está el pedido y qué necesitas de Soporte…" /></div><button className="primary-button" disabled={supportFormBusy}>{supportFormBusy ? "Enviando…" : "Enviar incidencia vinculada al pedido"}</button>{supportFormMessage && <p className="support-form-message">{supportFormMessage}</p>}</form>
                  {supportTicketId && <section className="support-chat-panel"><div className="support-chat-heading"><div><span>CHAT OPERATIVO</span><h2>{supportAgentName ? `Agente: ${supportAgentName}` : "Esperando asignación de agente"}</h2><p>{supportTicketStatus === "closed" || supportTicketStatus === "resolved" ? "La conversación ha sido cerrada por el agente." : "Mantén esta conversación abierta. El agente te irá indicando cada paso hasta resolver la incidencia."}</p></div><strong>{supportTicketStatus || "open"}</strong></div><div className="support-chat-messages">{supportChatMessages.map((message, index) => <article key={message._id || `${message.createdAt}-${index}`} className={message.senderRole === "rider" ? "chat-message chat-message-rider" : "chat-message chat-message-support"}><b>{message.senderRole === "rider" ? "Tú" : message.senderName || supportAgentName || "Agente de soporte"}</b><span>{message.body}</span><small>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></article>)}</div>{supportPeerTyping && <div className="typing-indicator" aria-live="polite"><i /><i /><i /> {supportAgentName || "El agente"} está escribiendo…</div>}{!['closed','resolved'].includes(supportTicketStatus) && <form className="support-chat-compose" onSubmit={sendSupportChatMessage}><input value={supportChatDraft} onChange={(event) => setSupportChatDraft(event.target.value)} placeholder="Escribe al agente de soporte…" /><button className="primary-button" disabled={supportChatBusy || !supportChatDraft.trim()}>{supportChatBusy ? "Enviando…" : "Enviar"}</button></form>}</section>}
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
              {section === "Inicio" && (
                <section className="feature-section current-order-panel">
                  <FeatureHeading
                    eyebrow="PIKI · PEDIDO ACTIVO"
                    title={
                      offers.some(
                        (offer) => offer.assignmentState === "assigned",
                      )
                        ? "Tu pedido en curso"
                        : "No tienes ningún pedido en curso"
                    }
                    lead="La información del reparto actual aparece siempre aquí arriba."
                    icon={<ClipboardList />}
                  />
                  {(() => {
                    const order = offers.find(
                      (offer) => offer.assignmentState === "assigned",
                    );
                    if (!order)
                      return (
                        <div className="empty-card">
                          <p className="empty-copy">
                            Activa tu jornada para recibir repartos asignados.
                          </p>
                        </div>
                      );
                    const phaseLabels: Record<string, string> = {
                      going_to_restaurant: "Yendo al restaurante",
                      waiting_for_food: "Esperando comida",
                      going_to_customer: "Yendo al cliente",
                      assigned: "Pedido aceptado",
                    };
                    const vehicleLabels: Record<string, string> = {
                      bike: "Bicicleta",
                      electric_bike: "Bicicleta eléctrica",
                      electric_scooter: "Patinete eléctrico",
                      motorcycle: "Moto",
                      scooter: "Moto",
                      car: "Coche",
                    };
                    return (
                      <>
                        <article className="current-order-card">
                          <div className="current-order-code">
                            #
                            {order.displayCode ||
                              order.publicCode ||
                              order._id.slice(-3)}
                          </div>
                          <div className="current-order-main">
                            <strong>
                              {phaseLabels[order.phase || "assigned"] ||
                                "Pedido aceptado"}
                            </strong>
                            <span>
                              {vehicleLabels[order.vehicle || ""] ||
                                "Vehículo asignado"}
                            </span>
                            <p>
                              {order.status === "ready_for_pickup" ||
                              order.status === "preparing"
                                ? order.restaurant?.name ||
                                  "Establecimiento PIKI"
                                : order.customerName || "Cliente"}
                            </p>
                            <p>
                              {order.status === "ready_for_pickup" ||
                              order.status === "preparing"
                                ? order.restaurant?.address ||
                                  "Dirección del establecimiento protegida"
                                : order.deliveryAddress ||
                                  "Dirección del cliente"}
                            </p>
                          </div>
                          <div className="current-order-eta">
                            <Clock3 size={17} />
                            <strong>
                              {order.etaMinutes == null
                                ? "—"
                                : `${order.etaMinutes} min`}
                            </strong>
                            <span>tiempo estimado</span>
                          </div>
                        </article>
                        <section className="order-chat-card">
                          <div>
                            <span className="eyebrow">CHAT DEL PEDIDO</span>
                            <h2>Comunicación con el cliente</h2>
                            <p>
                              Usa este canal para coordinar la entrega. No
                              muestra el teléfono del cliente.
                            </p>
                          </div>
                          <div className="order-chat-messages">
                            {orderMessages.length ? (
                              orderMessages.map((message) => (
                                <div
                                  className={`order-chat-message ${message.senderRole === "rider" ? "from-rider" : "from-customer"}`}
                                  key={message._id}
                                >
                                  <span>
                                    {message.senderRole === "rider"
                                      ? "Tú"
                                      : "Cliente"}
                                  </span>
                                  <p>{message.body}</p>
                                </div>
                              ))
                            ) : (
                              <p className="empty-copy">
                                Aún no hay mensajes en este pedido.
                              </p>
                            )}
                          </div>
                          <form
                            className="order-chat-form"
                            onSubmit={submitOrderMessage}
                          >
                            <input
                              value={messageDraft}
                              onChange={(event) =>
                                setMessageDraft(event.target.value)
                              }
                              maxLength={500}
                              placeholder="Escribe un mensaje al cliente…"
                              aria-label="Mensaje al cliente"
                            />
                            <button
                              className="primary-button"
                              disabled={messageBusy || !messageDraft.trim()}
                            >
                              {messageBusy ? "Enviando…" : "Enviar"}
                              <MessageCircle size={16} />
                            </button>
                          </form>
                        </section>
                      </>
                    );
                  })()}
                </section>
              )}
              {![
                "Ofertas",
                "Entregas",
                "Horarios",
                "Cartera",
                "Incentivos",
                "Estadísticas",
                "Mapa",
                "Soporte",
              ].includes(section) && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">PIKI · RIDERS</p>
                      <p className="brand-vibe">Tu turno, tu ritmo, tu ciudad.</p>
                      <h1>
                        {section === "Inicio"
                          ? "Cada entrega, clara desde el primer metro."
                          : section}
                      </h1>
                      <p className="lead">
                        Base operativa conectada a producción. Activa tu
                        jornada, consulta horarios y recibe ofertas en tu zona.
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setStatus("checking");
                        void loadRiderData();
                      }}
                    >
                      <Activity
                        size={17}
                        className={status === "checking" ? "spin" : ""}
                      />
                      Actualizar
                    </button>
                  </div>
                  <section className="rider-session-preview" aria-label="Inicio de jornada Rider">
                    <div className="rider-session-map">
                      <div className="rider-map-road road-one" />
                      <div className="rider-map-road road-two" />
                      <div className="rider-map-road road-three" />
                      <span className="rider-map-town town-one">Xàtiva</span>
                      <span className="rider-map-town town-two">Canals</span>
                      <span className="rider-map-town town-three">Sellent</span>
                      <span className="rider-location-dot" aria-label="Ubicación actual" />
                      <div className="rider-session-status"><span>Estado</span><strong>{shiftActive ? "En línea" : "Fuera de línea"}</strong><i /></div>
                      <button className="rider-session-menu" type="button" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu size={25} /></button>
                      <button className="rider-session-help" type="button" onClick={() => showSection("Soporte")} aria-label="Abrir soporte"><Headphones size={24} /></button>
                    </div>
                    <div className="rider-session-sheet">
                      <div className="rider-session-heading"><div><span>SESIÓN RESERVADA</span><h2>{reservedShiftCountdown || "Consulta tu próximo turno"}</h2></div><button type="button" onClick={() => showSection("Horarios")}>Ver todo</button></div>
                      {currentShift.shift ? <div className="rider-reserved-card">
                        <strong>{currentShift.shift.start} – {currentShift.shift.end}</strong>
                        <span><MapPinned size={18} /> {currentShift.shift.zone || "Zona asignada"}</span>
                        <div><b>1.00 x</b><button type="button" onClick={() => showSection("Horarios")}><CalendarDays size={19} /> Calendario</button></div>
                      </div> : <div className="rider-reserved-empty">No tienes una sesión reservada para este momento. Fleet debe asignarte fecha, horario y zona.</div>}
                      <button className="rider-session-start" type="button" disabled={shiftBusy || !currentShift.eligible || !currentShift.shift} onClick={() => void toggleShift()}>{shiftBusy ? "Comprobando…" : currentShift.eligible ? "Empezar sesión" : "Fuera del horario asignado"}</button>
                      <small className="rider-server-clock">Hora oficial PIKI · {authoritativeNow.date} {authoritativeNow.time} · Europe/Madrid</small>
                    </div>
                  </section>
                </>
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
    </LocationPermissionGate>
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
