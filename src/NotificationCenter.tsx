import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCheck,
  CircleHelp,
  Gift,
  MessageCircle,
  PackageCheck,
  ShieldCheck,
  X,
} from "lucide-react";
import { classifyNotificationCategory, notificationCategoryLabel, notificationGroups, type NotificationGroupId } from "./notificationCategories";
import "./NotificationCenter.css";

type InboxItem = {
  id: string;
  category?: string;
  title: string;
  body: string;
  url?: string;
  readAt: string | null;
  createdAt: string;
};

type InboxResponse = { notifications?: InboxItem[]; unreadCount?: number };
type Props = {
  apiOrigin: string;
  token: string;
  surface: "partner" | "fleet" | "admin" | "rider";
  onUnreadChange?: (summary: { support: number; customer: number }) => void;
  onUnauthorized?: () => void;
};
type Filter = "all" | NotificationGroupId;

const icons: Record<NotificationGroupId, typeof Bell> = {
  orders: PackageCheck,
  planning: CalendarDays,
  incentives: Gift,
  communication: MessageCircle,
  account: ShieldCheck,
  other: CircleHelp,
};

function safeDestination(url?: string) {
  if (!url || !url.startsWith("/") || url.startsWith("//")) return "/";
  try {
    const destination = new URL(url, window.location.origin);
    return destination.origin === window.location.origin ? `${destination.pathname}${destination.search}${destination.hash}` : "/";
  } catch {
    return "/";
  }
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Fecha no disponible"
    : date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export default function NotificationCenter({ apiOrigin, token, surface, onUnreadChange, onUnauthorized }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestInFlight = useRef<Promise<void> | null>(null);
  const lastLoadedAt = useRef(0);

  const load = useCallback(async (force = false) => {
    if (!token) return;
    const now = Date.now();
    if (!force && now - lastLoadedAt.current < 5_000) return;
    if (requestInFlight.current) return requestInFlight.current;
    const request = (async () => {
      setLoading(true);
      try {
        const response = await fetch(`${apiOrigin}/api/v1/notifications?limit=20`, {
          cache: "no-store",
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "X-PIKI-Surface": surface },
        });
        if (response.status === 401) { onUnauthorized?.(); return; }
        if (!response.ok) throw new Error("No se pudieron cargar los avisos.");
        const payload = await response.json() as InboxResponse;
        setItems(Array.isArray(payload.notifications) ? payload.notifications : []);
        setUnreadCount(Math.max(0, Number(payload.unreadCount || 0)));
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar los avisos.");
      } finally {
        lastLoadedAt.current = Date.now();
        setLoading(false);
      }
    })();
    requestInFlight.current = request;
    void request.finally(() => {
      if (requestInFlight.current === request) requestInFlight.current = null;
    });
    return request;
  }, [apiOrigin, onUnauthorized, surface, token]);

  useEffect(() => {
    const unread = items.filter((item) => !item.readAt);
    onUnreadChange?.({
      support: unread.filter((item) => classifyNotificationCategory(item.category) === "communication" && /support/i.test(item.category || "")).length,
      customer: unread.filter((item) => classifyNotificationCategory(item.category) === "communication" && /message|chat/i.test(item.category || "")).length,
    });
  }, [items, onUnreadChange]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(true), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    const refresh = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type || "";
      const relevant = ["order.", "support.", "onboarding.", "employee.", "rider.", "profile.", "document.", "compliance.", "incentive.", "quest.", "account."]
        .some((prefix) => type.startsWith(prefix));
      if (relevant) void load(true);
    };
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("piki:realtime", refresh);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(initialLoad);
      window.removeEventListener("piki:realtime", refresh);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const markAllRead = async () => {
    if (!token || unreadCount === 0) return;
    try {
      const response = await fetch(`${apiOrigin}/api/v1/notifications/read-all`, {
        method: "PATCH",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}`, "X-PIKI-Surface": surface },
      });
      if (response.status === 401) { onUnauthorized?.(); return; }
      if (!response.ok) throw new Error("No se pudieron marcar como leídos.");
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => item.readAt ? item : { ...item, readAt }));
      setUnreadCount(0);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron marcar como leídos.");
    }
  };

  const openNotification = async (item: InboxItem) => {
    if (!item.readAt) {
      try {
        const response = await fetch(`${apiOrigin}/api/v1/notifications/${encodeURIComponent(item.id)}/read`, {
          method: "PATCH",
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "X-PIKI-Surface": surface },
        });
        if (response.status === 401) { onUnauthorized?.(); return; }
        if (response.ok) {
          const readAt = new Date().toISOString();
          setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, readAt } : candidate));
          setUnreadCount((count) => Math.max(0, count - 1));
        }
      } catch { /* Opening a saved notification must not depend on a read-receipt response. */ }
    }
    setOpen(false);
    window.location.assign(safeDestination(item.url));
  };

  const visibleItems = filter === "all" ? items : items.filter((item) => classifyNotificationCategory(item.category) === filter);
  const unreadIn = (group?: NotificationGroupId) => items.filter((item) => !item.readAt && (!group || classifyNotificationCategory(item.category) === group)).length;
  const activeLabel = filter === "all" ? "notificaciones" : notificationCategoryLabel(filter).toLowerCase();

  return (
    <div className="piki-notification-center">
      <button
        className="piki-notification-trigger"
        type="button"
        aria-label={unreadCount ? `Notificaciones, ${unreadCount} sin leer` : "Notificaciones"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => { setOpen((value) => !value); if (!open) void load(true); }}
      >
        <Bell size={19} aria-hidden="true" />
        {unreadCount > 0 && <span className="piki-notification-badge" aria-live="polite">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      {open && (
        <section className="piki-notification-popover" role="dialog" aria-label="Centro de notificaciones">
          <header className="piki-notification-header">
            <div><strong>Notificaciones</strong><span>{unreadCount ? `${unreadCount} sin leer` : "Al día"}</span></div>
            <div className="piki-notification-actions">
              {unreadCount > 0 && <button type="button" onClick={() => void markAllRead()} aria-label="Marcar todas como leídas" title="Marcar todas como leídas"><CheckCheck size={17} /></button>}
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar notificaciones"><X size={18} /></button>
            </div>
          </header>
          <div className="piki-notification-filters" role="tablist" aria-label="Filtrar notificaciones">
            <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>Todas{unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}</button>
            {notificationGroups.map((group) => (
              <button key={group.id} type="button" role="tab" aria-selected={filter === group.id} className={filter === group.id ? "is-active" : ""} onClick={() => setFilter(group.id)}>
                {group.label}{unreadIn(group.id) > 0 && <b>{unreadIn(group.id) > 99 ? "99+" : unreadIn(group.id)}</b>}
              </button>
            ))}
          </div>
          <div className="piki-notification-list" aria-busy={loading}>
            {loading && items.length === 0 && <p className="piki-notification-empty">Cargando avisos…</p>}
            {!loading && visibleItems.length === 0 && <p className="piki-notification-empty">{items.length ? `No hay avisos de ${activeLabel}.` : "No tienes notificaciones nuevas."}</p>}
            {visibleItems.map((item) => {
              const group = classifyNotificationCategory(item.category);
              const Icon = icons[group];
              return <button type="button" className={`piki-notification-item is-${group} ${item.readAt ? "is-read" : "is-unread"}`} key={item.id} onClick={() => void openNotification(item)}>
                <span className="piki-notification-icon" aria-hidden="true"><Icon size={17} /></span>
                <span className="piki-notification-copy"><small className="piki-notification-category">{notificationCategoryLabel(group)}</small><strong>{item.title}</strong><span>{item.body}</span><small className="piki-notification-time">{formatCreatedAt(item.createdAt)}</small></span>
                {!item.readAt && <span className="piki-notification-dot" aria-label="Sin leer" />}
              </button>;
            })}
          </div>
          {error && <p className="piki-notification-error" role="status">{error}</p>}
        </section>
      )}
    </div>
  );
}
