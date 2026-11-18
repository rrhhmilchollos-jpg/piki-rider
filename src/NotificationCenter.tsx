import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { requiresRiderAuthentication } from "./apiAuthPolicy";
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
type Props = { apiOrigin: string; token: string; surface: "partner" | "fleet" | "admin" | "rider"; onUnreadChange?: (summary: { support: number; customer: number }) => void; onUnauthorized?: () => void };

export default function NotificationCenter({ apiOrigin, token, surface, onUnreadChange, onUnauthorized }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestInFlight = useRef<Promise<void> | null>(null);
  const lastLoadedAt = useRef(0);
  const mounted = useRef(true);
  const generation = useRef(0);
  const contextRef = useRef({ apiOrigin, token, surface });
  if (contextRef.current.apiOrigin !== apiOrigin || contextRef.current.token !== token || contextRef.current.surface !== surface) {
    contextRef.current = { apiOrigin, token, surface };
  }
  const context = contextRef.current;
  const itemsContext = useRef<typeof context | null>(null);
  const isCurrent = (epoch: number) => mounted.current && generation.current === epoch && contextRef.current === context;
  useEffect(() => {
    mounted.current = true;
    generation.current++;
    requestInFlight.current = null;
    lastLoadedAt.current = 0;
    itemsContext.current = null;
    setOpen(false);
    setItems([]);
    setUnreadCount(0);
    setLoading(false);
    setError("");
    return () => {
      mounted.current = false;
      generation.current++;
      requestInFlight.current = null;
    };
  }, [context]);
  const load = useCallback(async (force = false) => {
    const isCurrent = (epoch: number) => mounted.current && generation.current === epoch && contextRef.current === context;
    const epoch = generation.current;
    if (!token || !isCurrent(epoch)) return;
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
        if (!isCurrent(epoch)) return;
        const unauthorized = await requiresRiderAuthentication(response);
        if (!isCurrent(epoch)) return;
        if (unauthorized) { onUnauthorized?.(); return; }
        if (!response.ok) throw new Error("No se pudieron cargar los avisos.");
        const payload = await response.json() as InboxResponse;
        if (!isCurrent(epoch)) return;
        itemsContext.current = context;
        setItems(Array.isArray(payload.notifications) ? payload.notifications : []);
        setUnreadCount(Math.max(0, Number(payload.unreadCount || 0)));
        setError("");
      } catch (cause) {
        if (isCurrent(epoch)) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los avisos.");
      } finally {
        if (isCurrent(epoch)) {
          lastLoadedAt.current = Date.now();
          setLoading(false);
        }
      }
    })();
    requestInFlight.current = request;
    void request.finally(() => {
      if (isCurrent(epoch) && requestInFlight.current === request) requestInFlight.current = null;
    });
    return request;
  }, [apiOrigin, onUnauthorized, surface, token, context]);

  useEffect(() => {
    if (!mounted.current || contextRef.current !== context) return;
    const unread = itemsContext.current === context ? items.filter((item) => !item.readAt) : [];
    onUnreadChange?.({
      support: unread.filter((item) => item.category === "support").length,
      customer: unread.filter((item) => item.category === "message").length,
    });
  }, [items, onUnreadChange, context]);

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
    const epoch = generation.current;
    if (!token || unreadCount === 0 || !isCurrent(epoch)) return;
    try {
      const response = await fetch(`${apiOrigin}/api/v1/notifications/read-all`, {
        method: "PATCH",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}`, "X-PIKI-Surface": surface },
      });
      if (!isCurrent(epoch)) return;
      const unauthorized = await requiresRiderAuthentication(response);
      if (!isCurrent(epoch)) return;
      if (unauthorized) { onUnauthorized?.(); return; }
      if (!response.ok) throw new Error("No se pudieron marcar como leídos.");
      const readAt = new Date().toISOString();
      setItems((current) => isCurrent(epoch) ? current.map((item) => item.readAt ? item : { ...item, readAt }) : current);
      setUnreadCount(0);
      setError("");
    } catch (cause) {
      if (isCurrent(epoch)) setError(cause instanceof Error ? cause.message : "No se pudieron marcar como leídos.");
    }
  };

  const openNotification = async (item: InboxItem) => {
    const epoch = generation.current;
    if (!token || !isCurrent(epoch)) return;
    if (!item.readAt) {
      try {
        const response = await fetch(`${apiOrigin}/api/v1/notifications/${encodeURIComponent(item.id)}/read`, {
          method: "PATCH",
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "X-PIKI-Surface": surface },
        });
        if (!isCurrent(epoch)) return;
        const unauthorized = await requiresRiderAuthentication(response);
        if (!isCurrent(epoch)) return;
        if (unauthorized) { onUnauthorized?.(); return; }
        if (!response.ok) throw new Error("No se pudo marcar el aviso como leído.");
        const readAt = new Date().toISOString();
        setItems((current) => isCurrent(epoch) ? current.map((candidate) => candidate.id === item.id ? { ...candidate, readAt } : candidate) : current);
        setUnreadCount((count) => isCurrent(epoch) ? Math.max(0, count - 1) : count);
      } catch {
        // Keep the saved notice/unread count; navigation does not depend on the receipt.
        if (isCurrent(epoch)) setError("No se pudo marcar el aviso como leído. Puedes reintentarlo.");
      }
    }
    if (!isCurrent(epoch)) return;
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
