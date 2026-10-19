import { useEffect, useState, type FormEvent } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import type { RiderOffer } from "../types/rider";
import { loadRiderOrderMessages, sendRiderOrderMessage, type RiderOrderMessage } from "../integrations/piki-api";

type Props = { token: string; riderId: string; order: RiderOffer; onClose: () => void };

function reference(order: RiderOffer) {
  return order.displayCode || order.publicCode || order._id.slice(-6).toUpperCase();
}

export default function RiderOrderChatDialog({ token, riderId, order, onClose }: Props) {
  const [messages, setMessages] = useState<RiderOrderMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await loadRiderOrderMessages(token, riderId, order._id);
        if (!disposed) { setMessages(next); setError(""); setLoading(false); }
      } catch (caught) {
        if (!disposed) { setError(caught instanceof Error ? caught.message : "No se pudo actualizar el chat."); setLoading(false); }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [order._id, riderId, token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setError("");
    try {
      const message = await sendRiderOrderMessage(token, riderId, order._id, body);
      setMessages((previous) => [...previous, message]);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo enviar el mensaje.");
    } finally { setBusy(false); }
  }

  return <section className="rider-order-chat-dialog" role="dialog" aria-modal="true" aria-label={`Chat del pedido ${reference(order)}`}>
    <header><div><span><MessageCircle size={18}/> Chat del pedido</span><strong>#{reference(order)}</strong><small>{order.customerName || "Cliente final"}</small></div><button type="button" onClick={onClose} aria-label="Cerrar chat"><X size={20}/></button></header>
    <div className="rider-order-chat-thread" role="log" aria-live="polite" aria-label="Conversación con el cliente">
      {loading && <p className="rider-order-chat-muted">Conectando con el cliente…</p>}
      {!loading && messages.length === 0 && <p className="rider-order-chat-muted">Todavía no hay mensajes. Puedes avisar al cliente de tu llegada.</p>}
      {messages.map((message) => <div key={message._id} className={`rider-order-chat-bubble ${message.senderRole === "rider" ? "mine" : "theirs"}`}><p>{message.body}</p><time>{new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></div>)}
    </div>
    {error && <p className="rider-order-chat-error" role="alert">{error}</p>}
    <form onSubmit={submit}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Escribe un mensaje al cliente…" aria-label="Mensaje al cliente" maxLength={500}/><button type="submit" disabled={busy || !draft.trim()} aria-label="Enviar mensaje" title="Enviar mensaje"><Send size={18}/></button></form>
  </section>;
}
