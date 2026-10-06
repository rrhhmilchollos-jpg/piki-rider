import { useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { ArrowUpRight, MessageCircle, X } from "lucide-react";

export type RiderSupportChatMessage = {
  _id?: string;
  senderRole: string;
  senderName?: string;
  body: string;
  createdAt: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  agentName: string;
  ticketNumber: string;
  status: string;
  orderLabel: string;
  messages: RiderSupportChatMessage[];
  peerTyping: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string;
};

function statusLabel(status: string) {
  if (status === "in_progress") return "En curso";
  if (status === "waiting") return "Esperando";
  if (status === "resolved") return "Resuelto";
  if (status === "closed") return "Cerrado";
  return "Abierto";
}

export default function RiderSupportChatDialog({
  open,
  onClose,
  agentName,
  ticketNumber,
  status,
  orderLabel,
  messages,
  peerTyping,
  draft,
  onDraftChange,
  onSend,
  busy,
  error,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const closed = status === "closed" || status === "resolved";

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [open, messages.length, peerTyping]);

  if (!open) return null;

  return (
    <div className="support-chat-backdrop">
      <section
        className="support-chat-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rider-support-chat-title"
      >
        <header className="support-chat-window-header">
          <div className="support-chat-avatar" aria-hidden="true"><MessageCircle size={21} /></div>
          <div className="support-chat-window-title">
            <h2 id="rider-support-chat-title">Soporte PIKI</h2>
            <p>{agentName || "Esperando asignación de un agente"}</p>
          </div>
          <span className={`support-chat-status support-chat-status-${status || "open"}`}>{statusLabel(status)}</span>
          <button className="support-chat-window-close" type="button" aria-label="Minimizar chat" title="Minimizar chat" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="support-chat-case-strip">
          <strong>{orderLabel || "Incidencia de reparto"}</strong>
          <span>{ticketNumber ? `Caso ${ticketNumber}` : "Caso guardado en Soporte"}</span>
        </div>

        <div className="support-chat-thread" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Mensajes de la incidencia">
          <div className="support-chat-day-pill">Conversación con Soporte PIKI</div>
          {messages.map((message, index) => {
            const ownMessage = message.senderRole === "rider";
            const messageTime = new Date(message.createdAt);
            const time = Number.isNaN(messageTime.getTime())
              ? ""
              : messageTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
            return (
              <article
                key={message._id || `${message.createdAt}-${index}`}
                className={`support-chat-bubble ${ownMessage ? "support-chat-bubble-outgoing" : "support-chat-bubble-incoming"}`}
              >
                {!ownMessage && <b>{message.senderName || agentName || "Soporte PIKI"}</b>}
                <span>{message.body}</span>
                <small>{time}</small>
              </article>
            );
          })}
          {messages.length === 0 && <p className="support-chat-loading">Cargando los mensajes guardados del caso…</p>}
          <div ref={bottomRef} />
        </div>

        {peerTyping && !closed && (
          <div className="support-chat-window-typing" aria-live="polite">
            <i /><i /><i /> {agentName || "Soporte"} está escribiendo…
          </div>
        )}
        {error && <p className="support-chat-window-error" role="alert">{error}</p>}
        {closed ? (
          <div className="support-chat-closed-note">Este caso está cerrado. Puedes consultar aquí el historial de la conversación.</div>
        ) : (
          <form className="support-chat-window-compose" onSubmit={onSend}>
            <input
              aria-label="Escribe un mensaje a Soporte PIKI"
              autoComplete="off"
              maxLength={2000}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Escribe un mensaje…"
            />
            <button type="submit" aria-label="Enviar mensaje" title="Enviar mensaje" disabled={busy || !draft.trim()}>
              {busy ? <span className="support-chat-send-spinner" aria-hidden="true" /> : <ArrowUpRight size={21} />}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
