import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import "./NotificationCenter.css";

type InboxItem = {
  id: string;
  category: string;
  title: string;
  body: string;
  url: string;
  readAt: string | null;
  createdAt: string;
};

type InboxResponse = { notifications?: InboxItem[]; unreadCount?: number };
type Props = { apiOrigin: string; token: string; surface: "partner" | "fleet" | "admin" | "rider"; onUnreadChange?: (summary: { support: number; customer: number }) => void };

export default function NotificationCenter({ apiOrigin, token, surface, onUnreadChange }: Props) {
  const [open, setOpen] = useState(false);
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
        if (!response.ok) throw new Error(response.status === 401 ? "Vuelve a iniciar sesión para ver tus avisos." : "No se pudieron cargar los avisos.");
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
  }, [apiOrigin, surface, token]);

  useEffect(() => {
    const unread = items.filter((item) => !item.readAt);
    onUnreadChange?.({
      support: unread.filter((item) => item.category === "support").length,
      customer: unread.filter((item) => item.category === "message").length,
    });
  }, [items, onUnreadChange]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(true), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    const refresh = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type || "";
      const relevant = type.startsWith("order.") || type.startsWith("support.") || type.startsWith("onboarding.") || type.startsWith("employee.");
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
        await fetch(`${apiOrigin}/api/v1/notifications/${encodeURIComponent(item.id)}/read`, {
          method: "PATCH",
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "X-PIKI-Surface": surface },
        });
      } catch { /* Opening a saved notification must not depend on a read-receipt response. */ }
      const readAt = new Date().toISOString();
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, readAt } : candidate));
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    setOpen(false);
    const destination = item.url.startsWith("/") && !item.url.startsWith("//") ? item.url : "/";
    window.location.assign(destination);
  };

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
          <div className="piki-notification-list" aria-busy={loading}>
            {loading && items.length === 0 && <p className="piki-notification-empty">Cargando avisos…</p>}
            {!loading && items.length === 0 && <p className="piki-notification-empty">No tienes notificaciones nuevas.</p>}
            {items.map((item) => (
              <button type="button" className={`piki-notification-item ${item.readAt ? "is-read" : "is-unread"}`} key={item.id} onClick={() => void openNotification(item)}>
                <span className="piki-notification-dot" aria-hidden="true" />
                <span className="piki-notification-copy"><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</small></span>
              </button>
            ))}
          </div>
          {error && <p className="piki-notification-error" role="status">{error}</p>}
        </section>
      )}
    </div>
  );
}
