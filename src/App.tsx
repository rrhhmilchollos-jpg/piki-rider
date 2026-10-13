import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  Bell,
  Bike,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  FileText,
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
  UserRound,
} from "lucide-react";
import "./App.css";
import EmployeeAuthGate from "./EmployeeAuthGate";
import ActiveShiftScreen from "./components/ActiveShiftScreen";
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
  ["Horarios", CalendarDays],
  ["Cartera", WalletCards],
  ["Estadísticas", Activity],
  ["Soporte", LifeBuoy],
] as const;
const riderSectionStorageKey = `piki-${location.hostname}-rider-section`;
function getInitialRiderSection(): string {
  const requested = new URLSearchParams(window.location.search).get("section");
  const isKnownSection = (value: string | null): value is string =>
    Boolean(value && (value === "Solicitar alta" || value === "Perfil" || nav.some(([label]) => label === value)));
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
  const [showOperations, setShowOperations] = useState(false);
  const [startedShiftNotice, setStartedShiftNotice] = useState(false);
  const [riderId, setRiderId] = useState("");
  const [riderDisplayName, setRiderDisplayName] = useState("Rider");
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
  const [supportChatHidden, setSupportChatHidden] = useState(false);
  const [supportRating, setSupportRating] = useState(0);
  const [supportRatingComment, setSupportRatingComment] = useState("");
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

  const normalizeShift = useCallback((raw: any): Shift => ({
    ...raw,
    day: String(raw?.day || "").replace(/^./, (value: string) => value.toUpperCase()),
    start: String(raw?.start || raw?.startTime || ""),
    end: String(raw?.end || raw?.endTime || ""),
    zone: String(raw?.zone || raw?.zoneSlug || ""),
    status: raw?.status || "planned",
  }), []);

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
        rider?: { id?: string; status?: string; name?: string; firstName?: string };
      };
      const id = String(sessionData.rider?.id || "");
      if (!id) return;
      markStoredTokenValidated();
      setRiderId(id);
      setRiderDisplayName(
        String(sessionData.rider?.firstName || sessionData.rider?.name || "Rider").trim() || "Rider",
      );
      const [slotResponse, statsResponse, shiftResponse, cashResponse] =
        await Promise.all([
          fetch(`${apiOrigin}/api/v1/riders/${id}/slots`, { headers }),
          fetch(`${apiOrigin}/api/v1/riders/statistics`, { headers }),
          fetch(`${apiOrigin}/api/v1/riders/${id}/shift`, { headers }),
          fetch(`${apiOrigin}/api/v1/riders/${id}/cash-wallet`, { headers }),
        ]);
      if (slotResponse.ok) {
        const data = (await slotResponse.json()) as { slots?: Shift[] };
        setShifts(Array.isArray(data.slots) ? data.slots.map(normalizeShift) : []);
      }
      if (shiftResponse.ok) {
        const raw = (await shiftResponse.json()) as CurrentShift;
        const data = { ...raw, shift: raw.shift ? normalizeShift(raw.shift) : null };
        setCurrentShift(data);
        setShiftActive(data.shift?.status === "active" && Boolean(data.shift.start && data.shift.end && data.shift.zone));
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
  }, [apiToken, normalizeShift]);

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
    const pollOffers = async () => {
      if (!disposed) setOffersLoading(true);
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
        if (!disposed) setOffersLoading(false);
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
        if (event.type === "order.message_created") {
          const eventOrderId = String(event.payload.orderId || "");
          if (eventOrderId && eventOrderId === String(activeOrder?._id)) {
            void loadRiderOrderMessages(apiToken, riderId, eventOrderId).then(setOrderMessages).catch(() => undefined);
          }
          return;
        }
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
  }, [apiToken, riderId, shiftActive, playAssignmentAlert, activeOrder?._id]);
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

  const hasAssignedSlotNow = useMemo(() => {
    const now = new Date();
    const dayName = weekdayNames[(now.getDay() + 6) % 7];
    const minutes = now.getHours() * 60 + now.getMinutes();
    return shifts.some((shift) => {
      if (!['assigned', 'planned', 'active'].includes(shift.status)) return false;
      if (shift.date && shift.date !== now.toISOString().slice(0, 10)) return false;
      if (shift.day && shift.day !== dayName) return false;
      if (!shift.start || !shift.end) return false;
      const [startHour, startMinute] = shift.start.split(':').map(Number);
      const [endHour, endMinute] = shift.end.split(':').map(Number);
      const start = startHour * 60 + startMinute;
      const end = endHour * 60 + endMinute;
      return Number.isFinite(start) && Number.isFinite(end) && minutes >= start && minutes <= end;
    });
  }, [shifts]);
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
    if (!shiftActive && (!currentShift.eligible || !hasAssignedSlotNow)) {
      setToast(
        "No hay un turno disponible ahora. Revisa Horarios o contacta con Fleet.",
      );
      return;
    }
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
              accuracy: Number.isFinite(position.coords.accuracy) ? Math.min(100000, Math.max(0, position.coords.accuracy)) : undefined,
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
    action: "accept" | "picked_up" | "on_the_way",
  ) {
    if (orderActionBusy) return;
    setOrderActionBusy(true);
    try {
      if (action === "accept") {
        const response = await fetch(`${apiOrigin}/api/v1/dispatch/orders/${orderId}/offer-response`, {
          method: "POST",
          headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" },
          body: JSON.stringify({ accept: true }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setToast(data.message || data.error || "No se pudo aceptar el pedido. Reintenta sin cerrar la jornada.");
          await loadRiderData();
          return;
        }
        setToast("Pedido aceptado. Dirígete al establecimiento.");
        await loadRiderData();
        return;
      }
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
      setToast(
        action === "picked_up"
          ? "Recogida confirmada. Ya puedes iniciar la ruta."
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
    if (!shiftActive || !activeOrder) { setSupportFormMessage("Solo puedes solicitar asistencia si estás online y tienes un pedido asignado activo."); return; }
    setSupportFormBusy(true); setSupportFormMessage("");
    try {
      const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ subject: supportForm.subject.trim(), description: supportForm.description.trim(), priority: supportForm.priority, orderId: activeOrder?._id }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || "No se pudo enviar la incidencia.");
      setSupportForm({ subject: "", description: "", priority: "high" }); setSupportTicketId(String(data.ticket?.id || data.ticket?._id || "")); setSupportFormMessage("Chat abierto. Un agente de soporte responderá aquí y te indicará los pasos a seguir.");
    } catch (error) { setSupportFormMessage(error instanceof Error ? error.message : "No se pudo enviar la incidencia."); } finally { setSupportFormBusy(false); }
  }
  const refreshSupportChat = useCallback(async () => {
    if (!apiToken || !riderId || !supportTicketId) return;
    try { const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets`, { headers: { ...authHeaders(apiToken), "X-PIKI-Surface": "rider" } }); if (!response.ok) return; const data = await response.json() as { tickets?: any[] }; const ticket = (data.tickets || []).find((item) => String(item._id) === supportTicketId); if (ticket) { setSupportTicketStatus(ticket.status || ""); setSupportAgentName(ticket.assignedTo?.name || ticket.messages?.find((message: any) => message.senderRole === "support")?.senderName || "Agente de soporte"); setSupportChatMessages(Array.isArray(ticket.messages) ? ticket.messages : []); } } catch { /* el chat conserva el último estado mientras vuelve la red */ }
  }, [apiToken, riderId, supportTicketId]);
  useEffect(() => {
    if (!apiToken || !riderId || supportTicketId) return;
    void (async () => { try { const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets`, { headers: { ...authHeaders(apiToken), "X-PIKI-Surface": "rider" } }); if (!response.ok) return; const data = await response.json() as { tickets?: any[] }; const openTicket = (data.tickets || []).find((item) => !["closed", "resolved"].includes(item.status)); if (openTicket) setSupportTicketId(String(openTicket._id)); } catch { /* sin conexión, se reintentará al enviar una incidencia */ } })();
  }, [apiToken, riderId, supportTicketId]);
  // Polling the support thread intentionally synchronizes external ticket state.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (!supportTicketId) return; void refreshSupportChat(); const timer = window.setInterval(() => void refreshSupportChat(), 2000); return () => window.clearInterval(timer); }, [supportTicketId, refreshSupportChat]);
  async function sendSupportChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const body = supportChatDraft.trim(); if (!body || !apiToken || !riderId || !supportTicketId || supportChatBusy) return; setSupportChatBusy(true);
    try { const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets/${supportTicketId}/messages`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ body }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || data.error || "El chat está cerrado."); setSupportChatDraft(""); setSupportFormMessage(""); if (data.ticket?.messages) setSupportChatMessages(data.ticket.messages); else void refreshSupportChat(); } catch (error) { setSupportFormMessage(error instanceof Error ? error.message : "No se pudo enviar el mensaje."); } finally { setSupportChatBusy(false); }
  }
  async function rateAndCloseSupportChat() {
    if (!supportRating || !apiToken || !riderId || !supportTicketId || supportChatBusy) return;
    setSupportChatBusy(true);
    try {
      const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/support/tickets/${supportTicketId}/rating`, { method: "POST", headers: { ...authHeaders(apiToken), "Content-Type": "application/json", "X-PIKI-Surface": "rider" }, body: JSON.stringify({ rating: supportRating, comment: supportRatingComment.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || "No se pudo guardar la valoración.");
      setSupportTicketStatus("closed"); setSupportChatHidden(true); setSupportFormMessage("Valoración guardada. El chat se ha cerrado definitivamente.");
    } catch (error) { setSupportFormMessage(error instanceof Error ? error.message : "No se pudo guardar la valoración."); } finally { setSupportChatBusy(false); }
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
    if (!shiftActive || !activeOrder) { setToast("La asistencia de soporte está disponible cuando estás online y tienes un pedido asignado activo."); return; }
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
  const logout = async () => {
    try {
      await fetch(`${apiOrigin}/api/v1/auth/employee/logout`, {
        method: "POST",
        headers: authHeaders(apiToken),
      });
    } catch {}
    clearStoredToken();
    setApiToken("");
    setProfileOpen(false);
    setAuthRequired(false);
  };
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
        <div className="rider-drawer-header">
          <div className="rider-drawer-orb rider-drawer-orb-one" />
          <div className="rider-drawer-orb rider-drawer-orb-two" />
          <div className="rider-drawer-title">
            <span className="rider-drawer-kicker">PIKI · RIDERS</span>
            <strong>Hola, {riderDisplayName}</strong>
            <span className="rider-drawer-wave" aria-hidden="true">👋</span>
          </div>
          <button
            className="close-menu"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="rider-drawer-nav">
          <div className="rider-drawer-shortcuts">
            {(
              [
                ["Bandeja de entrada", Bell, "Ofertas"],
                ["Horario", CalendarDays, "Horarios"],
                ["Cartera", WalletCards, "Cartera"],
                ["Detalles sobre la actividad", Activity, "Estadísticas"],
              ] as const
            ).map(([label, Icon, target]) => (
              <button key={label} className="rider-drawer-shortcut" onClick={() => showSection(target)}>
                <Icon size={28} strokeWidth={2.2} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="rider-drawer-links">
            <button className="rider-drawer-link" onClick={() => showSection("Perfil")}>
              <UserRound size={25} />
              <span>Mi perfil</span>
            </button>
            <button className="rider-drawer-link" onClick={() => showSection("Ofertas")}>
              <BriefcaseBusiness size={25} />
              <span>Oportunidades</span>
            </button>
            <button className="rider-drawer-link" onClick={() => showSection("Soporte")}>
              <BookOpen size={25} />
              <span>Recursos</span>
              <ChevronDown size={20} className="rider-drawer-link-chevron" />
            </button>
            <button className="rider-drawer-link" onClick={() => showSection("Perfil")}>
              <Settings size={25} />
              <span>Configuración y privacidad</span>
            </button>
          </div>
          <div className="rider-drawer-status">
            <span className="support-dot" />
            <span><strong>Red PIKI</strong><small>{status === "ready" ? "Conectada" : "Comprobando"}</small></span>
          </div>
          {/* Mantiene los destinos existentes accesibles para lectores y navegación profunda. */}
          <div className="rider-drawer-legacy-nav" aria-hidden="true">
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
          </div>
        </nav>
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
                onClick={() => showSection("Perfil")}
                aria-expanded={profileOpen}
                aria-label="Abrir perfil"
              >
                <span className="user-avatar">R</span>
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <strong>Cuenta Rider</strong>
                  <span>{riderId ? `ID Rider ${riderId}` : "Sesión operativa activa"}</span>
                  <button
                    className="profile-logout"
                    onClick={() => void logout()}
                  >
                    Cerrar sesión
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
                            <button className="primary-button" disabled={orderActionBusy} onClick={() => { const code = window.prompt("Introduce el PIN o pega el QR que muestra el Partner para confirmar la recogida."); if (code?.trim()) void confirmPickup(offer._id, code.trim()); }}>
                              Validar recogida QR/PIN
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
                      <span>Asignaciones recibidas desde Fleet</span>
                    </div>
                    <span className="zone-chip">{currentShift.shift?.zone || shifts.find((shift) => shift.zone)?.zone || "Zona pendiente"}</span>
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
                          : (currentShift.eligible && hasAssignedSlotNow)
                            ? currentShift.selfStartAllowed
                              ? "Puedes abrir tu jornada diaria ahora en una zona operativa activa."
                              : "Tu turno está abierto: puedes iniciar ahora."
                            : "No hay un turno disponible en esta franja. Revisa los horarios o contacta con Fleet."}
                      </span>
                    </div>
                    <button
                      className="primary-button rider-shift-start-button"
                      disabled={shiftBusy || (!shiftActive && !hasAssignedSlotNow)}
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
                  <form className="support-ticket-form" onSubmit={submitSupportTicket}>
                    <div><span>INCIDENCIA OPERATIVA</span><h2>Enviar caso a Soporte PIKI</h2><p>{activeOrder ? `Se adjuntará automáticamente el pedido ${activeOrder.displayCode || activeOrder.publicCode || activeOrder._id.slice(-6)}, el cliente, la dirección, el comercio, los artículos y el importe.` : "Puedes enviar una consulta general; si tienes un pedido activo se adjuntará su contexto."}</p></div>
                    <div className="support-ticket-fields"><input required value={supportForm.subject} onChange={(event) => setSupportForm({ ...supportForm, subject: event.target.value })} placeholder="Asunto de la incidencia" /><select value={supportForm.priority} onChange={(event) => setSupportForm({ ...supportForm, priority: event.target.value })}><option value="urgent">Urgente · pedido bloqueado</option><option value="high">Alta</option><option value="normal">Normal</option></select><textarea required rows={4} value={supportForm.description} onChange={(event) => setSupportForm({ ...supportForm, description: event.target.value })} placeholder="Explica qué ocurre, dónde está el pedido y qué necesitas de Soporte…" /></div>{(!shiftActive || !activeOrder) && <p className="support-form-message">La asistencia sobre pedidos está disponible solo para Riders online con un pedido asignado activo.</p>}<button className="primary-button" disabled={supportFormBusy || !shiftActive || !activeOrder}>{supportFormBusy ? "Enviando…" : "Solicitar asistencia sobre este pedido"}</button>{supportFormMessage && <p className="support-form-message">{supportFormMessage}</p>}</form>
                  {supportTicketId && <section className="support-chat-panel"><div className="support-chat-heading"><div><span>CHAT OPERATIVO</span><h2>{supportAgentName ? `Agente: ${supportAgentName}` : "Esperando asignación de agente"}</h2><p>{supportTicketStatus === "closed" || supportTicketStatus === "resolved" ? "La conversación ha sido cerrada por el agente." : "Mantén esta conversación abierta. El agente te irá indicando cada paso hasta resolver la incidencia."}</p></div><strong>{supportTicketStatus || "open"}</strong><button type="button" aria-label="Cerrar vista del chat" onClick={() => setSupportChatHidden(true)}>×</button></div>{supportChatHidden ? <button type="button" className="secondary-button" onClick={() => setSupportChatHidden(false)}>Volver al chat</button> : <><p className="support-form-message">{["open", "waiting"].includes(supportTicketStatus) ? "El próximo agente disponible te atenderá en breve. Quédate a la espera de su respuesta." : "Puedes continuar escribiendo a soporte."}</p><div className="support-quick-replies">{["No puedo localizar al cliente; necesito instrucciones", "El pedido está bloqueado", "Necesito ayuda con la recogida", "Necesito ayuda con la entrega"].map((quickMessage) => <button type="button" key={quickMessage} onClick={() => setSupportChatDraft(quickMessage)}>{quickMessage}</button>)}</div><div className="support-chat-messages">{supportChatMessages.map((message, index) => <article key={message._id || `${message.createdAt}-${index}`} className={message.senderRole === "rider" ? "chat-message chat-message-rider" : "chat-message chat-message-support"}><b>{message.senderRole === "rider" ? "Tú" : message.senderName || supportAgentName || "Agente de soporte"}</b><span>{message.body}</span><small>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></article>)}</div>{!['closed','resolved'].includes(supportTicketStatus) && <form className="support-chat-compose" onSubmit={sendSupportChatMessage}><input value={supportChatDraft} onChange={(event) => setSupportChatDraft(event.target.value)} placeholder="Escribe al agente de soporte…" autoComplete="off" /><button type="submit" className="primary-button" disabled={supportChatBusy || !supportChatDraft.trim()}>{supportChatBusy ? "Enviando…" : "Enviar"}</button></form>}{supportTicketStatus === "resolved" && <div className="support-rating-panel"><strong>¿Cómo fue la atención del agente?</strong><div className="support-rating-stars">{[1,2,3,4,5].map((star) => <button type="button" key={star} aria-label={`${star} estrellas`} onClick={() => setSupportRating(star)} className={star <= supportRating ? "selected" : ""}>★</button>)}</div><textarea rows={2} value={supportRatingComment} onChange={(event) => setSupportRatingComment(event.target.value)} placeholder="Comentario opcional" /><button type="button" className="primary-button" disabled={!supportRating || supportChatBusy} onClick={() => void rateAndCloseSupportChat()}>Cerrar el chat definitivamente</button><button type="button" className="secondary-button" onClick={() => setSupportChatHidden(false)}>Volver al chat</button></div>}{supportFormMessage && <p className="support-form-message" role="alert">{supportFormMessage}</p>}</>}</section>}
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
              {section === "Perfil" && (
                <section className="rider-profile-page" aria-labelledby="rider-profile-title">
                  <header className="rider-profile-topbar">
                    <button type="button" className="rider-profile-back" onClick={() => showSection("Inicio")} aria-label="Volver">
                      <ChevronRight size={29} />
                    </button>
                    <h1 id="rider-profile-title">Perfil</h1>
                    <span aria-hidden="true" />
                  </header>
                  <div className="rider-profile-identity">
                    <div className="rider-profile-avatar">
                      <img src="/piki-icon-192.png" alt="Avatar PIKI" />
                    </div>
                    <h2>{riderDisplayName}</h2>
                    <p>ID <strong>{riderId || "—"}</strong></p>
                  </div>
                  <div className="rider-profile-options">
                    {([
                      ["Cuenta", "Consulta tus datos de acceso y cuenta."],
                      ["Vehículos", "Gestiona el vehículo autorizado para repartir."],
                      ["Más información", "Consulta ayuda, privacidad y condiciones."],
                    ] as const).map(([label, description]) => (
                      <button
                        type="button"
                        className="rider-profile-option"
                        key={label}
                        onClick={() => setToast(`${label}: disponible desde tu panel Fleet.`)}
                      >
                        <span><strong>{label}</strong><small>{description}</small></span>
                        <ChevronRight size={27} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {![
                "Ofertas",
                "Entregas",
                "Horarios",
                "Cartera",
                "Estadísticas",
                "Soporte",
                "Perfil",
              ].includes(section) && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">PIKI · RIDERS</p>
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
                  <section className="empty-state-grid">
                    <article className="empty-card primary-empty">
                      <div className="empty-card-top">
                        <span>JORNADA</span>
                        <Power size={18} />
                      </div>
                      <h2>
                        {shiftActive
                          ? "Estás conectado a tu zona."
                          : "Tu jornada empieza aquí."}
                      </h2>
                      <p>
                        {shiftActive
                          ? "El Fleet puede enviarte ofertas mientras mantengas la jornada activa."
                          : currentShift.eligible
                            ? "Estás listo para conectarte. Mantén la ubicación activa para recibir repartos."
                            : "No hay un turno disponible ahora. Consulta Horarios o contacta con Fleet."}
                      </p>
                      <button
                        className="primary-button rider-shift-hero-button"
                        disabled={shiftBusy || (!shiftActive && !hasAssignedSlotNow)}
                        onClick={() => void toggleShift()}
                      >
                        <Power size={20} />
                        {shiftBusy
                          ? "Iniciando jornada…"
                          : shiftActive
                            ? "FINALIZAR JORNADA"
                            : "INICIAR JORNADA"}
                      </button>
                    </article>
                    <article className="empty-card">
                      <div className="empty-card-top">
                        <span>UBICACIÓN</span>
                        <MapPinned size={18} />
                      </div>
                      <h2>Ubicación protegida durante la jornada</h2>
                      <p>
                        La ubicación GPS se comparte automáticamente mientras la jornada está activa. La vista operativa aparece junto a tus pedidos.
                      </p>
                      <button
                        className="secondary-button"
                        onClick={() => showSection("Horarios")}
                      >
                        Ver horarios
                      </button>
                    </article>
                  </section>
                </>
              )}
            </>
          )}
        </section>
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
