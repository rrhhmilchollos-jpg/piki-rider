/**
 * Cierre del pago en las entregas a contra­rreembolso.
 *
 * Al llegar a la puerta el rider tiene dos salidas y solo dos:
 *  - Cobró en efectivo  → se libera la retención. El cliente no ve ningún cargo.
 *  - No pudo cobrar    → se captura la retención, total o parcial.
 *
 * Si no se pulsa nada, la retención caduca sola a los 7 días y PIKI se queda sin
 * cobrar, así que el botón tiene que estar en la misma pantalla que "Entregado".
 */
import { useCallback, useState } from "react";

export interface CodPaymentActionsProps {
  orderId: string;
  totalCents: number;
  apiBaseUrl?: string;
  /** Token de sesión del rider (JWT de empleado). */
  token?: string | null;
  /** Se llama cuando Stripe confirma la operación. */
  onResolved: (result: { action: "released" | "captured"; amountCents: number }) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}

function formatEuros(cents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

type Pending = null | "release" | "capture";

export default function CodPaymentActions({
  orderId,
  totalCents,
  apiBaseUrl = "https://piki-api-37nr.onrender.com",
  token,
  onResolved,
  onError,
  disabled,
}: CodPaymentActionsProps) {
  const [pending, setPending] = useState<Pending>(null);
  // El cobro en efectivo no se registra de un toque: primero se confirma el importe.
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Pending>(null);

  const call = useCallback(
    async (action: "release" | "capture") => {
      setPending(action);
      setError(null);
      try {
        const path =
          action === "release"
            ? `/api/v1/admin/orders/${encodeURIComponent(orderId)}/cod-release`
            : `/api/v1/admin/orders/${encodeURIComponent(orderId)}/cod-capture`;
        const response = await fetch(`${apiBaseUrl}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(
            action === "release"
              ? { reason: "paid_in_cash" }
              : { amountCents: totalCents },
          ),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          capturedCents?: number;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "No se ha podido cerrar el pago");
        }
        setResolved(action);
        onResolved({
          action: action === "release" ? "released" : "captured",
          amountCents: payload.capturedCents ?? totalCents,
        });
      } catch (caught) {
        const message = (caught as Error).message;
        setError(message);
        onError?.(message);
      } finally {
        setPending(null);
      }
    },
    [apiBaseUrl, onError, onResolved, orderId, token, totalCents],
  );

  if (resolved === "release") {
    return (
      <div className="cod-actions cod-actions--done" role="status">
        Pago en efectivo registrado. Retención liberada, no se cobra nada al cliente.
      </div>
    );
  }
  if (resolved === "capture") {
    return (
      <div className="cod-actions cod-actions--done" role="status">
        Cobrado {formatEuros(totalCents)} en la tarjeta del cliente.
      </div>
    );
  }

  return (
    <div className="cod-actions">
      <p className="cod-actions__amount">
        A cobrar en la puerta: <strong>{formatEuros(totalCents)}</strong>
      </p>

      <button
        type="button"
        className="cod-actions__button cod-actions__button--cash"
        onClick={() => setConfirmingRelease(true)}
        disabled={disabled || pending !== null}
      >
        Cobrado en efectivo
      </button>

      <button
        type="button"
        className="cod-actions__button cod-actions__button--capture"
        onClick={() => void call("capture")}
        disabled={disabled || pending !== null}
      >
        {pending === "capture" ? "Cobrando…" : "No pudo pagar · cobrar tarjeta"}
      </button>

      {confirmingRelease && (
        <div
          className="cod-actions__confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cod-confirm-title"
        >
          <div className="cod-actions__confirm-card">
            <p className="cod-actions__confirm-eyebrow">CONFIRMAR COBRO</p>
            <h3 id="cod-confirm-title">{formatEuros(totalCents)} en efectivo</h3>
            <p className="cod-actions__confirm-copy">
              ¿Has recibido <strong>{formatEuros(totalCents)}</strong> en efectivo del cliente?
              Al confirmar se libera su retención y el pedido queda cobrado por ese importe.
            </p>
            <button
              type="button"
              className="cod-actions__button cod-actions__button--cash"
              onClick={() => {
                setConfirmingRelease(false);
                void call("release");
              }}
              disabled={pending !== null}
            >
              {pending === "release" ? "Registrando…" : `Sí, he cobrado ${formatEuros(totalCents)}`}
            </button>
            <button
              type="button"
              className="cod-actions__button cod-actions__button--cancel"
              onClick={() => setConfirmingRelease(false)}
              disabled={pending !== null}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="cod-actions__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
