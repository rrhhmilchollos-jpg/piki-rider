import {
  shouldPublishRiderGpsFix,
  validGpsPoint,
  type GpsPoint,
  type GpsFix,
} from "./riderGpsPolicy";

export type RiderGpsDiagnosticEvent = "watch_start" | "watch_stop" | "fix_received" | "send_ack" | "send_error";

export type GpsCallbacks = {
  onLocation: (point: GpsFix) => void;
  onError: (error: Error) => void;
  isCurrent: () => boolean;
};

export type GpsPort = {
  add: (callbacks: GpsCallbacks) => Promise<string>;
  remove: (id: string) => Promise<void>;
  publish: (point: GpsPoint) => Promise<void>;
  diagnose?: (event: RiderGpsDiagnosticEvent) => Promise<void> | void;
};

export type RiderGpsSnapshot = {
  state: "idle" | "starting" | "waiting" | "tracking" | "error";
  detail: string;
  lastFixAt?: number;
  lastAckAt?: number;
  accuracy?: number;
  autoRetryAllowed?: boolean;
};

export class RiderGpsAuthorizationError extends Error {}
export class RiderGpsPermissionError extends Error {}

/**
 * Owns exactly one location watcher. A stopped or superseded generation cannot
 * publish, acknowledge, update the map, or update UI state again.
 */
export class RiderGpsTracker {
  private generation = 0;
  private watcher: string | null = null;
  private readonly pendingRemoval = new Set<string>();
  private inFlight: Promise<void> | null = null;
  private pendingPoint: GpsFix | null = null;
  private lastReceivedTimestamp = -Infinity;
  private lastPublishedPoint: GpsPoint | null = null;
  private lastPublishedAt = 0;
  private lastResumeAt = -Infinity;
  private removal: Promise<void> = Promise.resolve();
  private readonly port: GpsPort;
  private readonly onChange: (state: RiderGpsSnapshot) => void;
  private readonly onFix?: (point: GpsPoint) => void;
  private snapshot: RiderGpsSnapshot = {
    state: "idle",
    detail: "El GPS de este dispositivo está detenido.",
  };

  constructor(port: GpsPort, onChange: (state: RiderGpsSnapshot) => void, onFix?: (point: GpsPoint) => void) {
    this.port = port;
    this.onChange = onChange;
    this.onFix = onFix;
  }

  private emit(next: Partial<RiderGpsSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    this.onChange({ ...this.snapshot });
  }

  private diagnose(event: RiderGpsDiagnosticEvent) {
    void Promise.resolve(this.port.diagnose?.(event)).catch(() => undefined);
  }

  /** Only foreground/online recovery calls this; explicit user retry uses start(). */
  async resume() {
    if (this.snapshot.state !== "idle" && this.snapshot.state !== "error") return;
    if (this.snapshot.autoRetryAllowed === false || Date.now() - this.lastResumeAt < 15_000) return;
    this.lastResumeAt = Date.now();
    await this.start();
  }

  async start() {
    const generation = ++this.generation;
    this.inFlight = null;
    this.pendingPoint = null;
    this.lastPublishedPoint = null;
    this.lastPublishedAt = 0;
    this.lastReceivedTimestamp = -Infinity;
    try {
      await this.removeCurrentWatcher();
      if (generation !== this.generation) return;
      this.snapshot = {
        state: "starting",
        detail: "Solicitando permisos y activando el servicio GPS…",
      };
      this.emit({});
      const id = await this.port.add({
        isCurrent: () => generation === this.generation,
        onLocation: (point) => { void this.receiveFix(point, generation); },
        onError: (error) => {
          if (generation !== this.generation) return;
          const terminal = error instanceof RiderGpsPermissionError || error instanceof RiderGpsAuthorizationError;
          if (terminal) this.stop();
          // A timeout/unavailable fix is not a revoked permission. Keep the
          // watcher and publish the next real fix immediately to recover.
          else this.lastPublishedAt = 0;
          this.emit({ state: "error", detail: error.message, autoRetryAllowed: !terminal });
        },
      });
      if (generation !== this.generation) {
        this.pendingRemoval.add(id);
        await this.removeCurrentWatcher();
        return;
      }
      this.watcher = id;
      this.diagnose("watch_start");
      if (this.snapshot.state === "starting") {
        this.emit({
          state: "waiting",
          detail: "Servicio activo. Esperando una posición GPS y la confirmación de la API.",
        });
      }
    } catch (error) {
      if (generation !== this.generation) {
        if (this.pendingRemoval.size) this.reportStopFailure();
        return;
      }
      ++this.generation;
      this.emit({
        state: "error",
        detail: error instanceof Error ? error.message : "No se pudo activar el GPS.",
        autoRetryAllowed: !(error instanceof RiderGpsPermissionError || error instanceof RiderGpsAuthorizationError),
      });
    }
  }

  stop() {
    ++this.generation;
    this.inFlight = null;
    this.pendingPoint = null;
    this.lastPublishedPoint = null;
    this.lastPublishedAt = 0;
    this.snapshot = {
      state: "idle",
      detail: "Seguimiento detenido. No se enviarán nuevas posiciones.",
    };
    this.emit({});
    void this.removeCurrentWatcher().catch(() => this.reportStopFailure());
  }

  private reportStopFailure() {
    this.emit({
      state: "error",
      detail: "No se pudo confirmar la retirada del servicio GPS. Pulsa Reintentar GPS para volver a retirarlo; si persiste, detén PIKI Riders desde los ajustes de Android.",
      autoRetryAllowed: false,
    });
  }

  private removeCurrentWatcher() {
    if (this.watcher !== null) {
      this.pendingRemoval.add(this.watcher);
      this.watcher = null;
    }
    this.removal = this.removal.catch(() => undefined).then(async () => {
      for (const id of this.pendingRemoval) {
        try {
          await this.port.remove(id);
        } catch {
          // Retry once immediately; retain the id when native removal still fails.
          await this.port.remove(id);
        }
        this.pendingRemoval.delete(id);
        this.diagnose("watch_stop");
      }
    });
    return this.removal;
  }

  private isFreshFix(point: GpsFix) {
    const age = Date.now() - point.timestamp;
    return Number.isFinite(point.timestamp) && age >= 0 && age <= 15_000;
  }

  private async receiveFix(point: GpsFix, generation: number) {
    if (generation !== this.generation) return;
    this.diagnose("fix_received");
    if (!validGpsPoint(point)) {
      this.emit({ detail: "Posición descartada: precisión insuficiente o coordenadas no válidas." });
      return;
    }
    if (!this.isFreshFix(point) || point.timestamp <= this.lastReceivedTimestamp) return;
    this.lastReceivedTimestamp = point.timestamp;
    this.onFix?.(point);
    this.emit({ lastFixAt: point.timestamp, accuracy: point.accuracy });
    if (this.inFlight) {
      // Preserve only the newest valid fix while the network request is active.
      this.pendingPoint = point;
      return;
    }
    await this.flushPendingFixes(point, generation);
  }

  private async flushPendingFixes(firstPoint: GpsFix, generation: number) {
    let point: GpsFix | null = firstPoint;
    while (point && generation === this.generation) {
      // A fix queued behind a slow POST must not become a stored heartbeat.
      if (!this.isFreshFix(point)) return;
      if (!shouldPublishRiderGpsFix(point, this.lastPublishedPoint, this.lastPublishedAt)) {
        if (this.snapshot.state === "tracking") {
          this.emit({ detail: "Posición recibida sin desplazamiento relevante; el GPS sigue activo." });
        }
      } else {
        const request = this.publish(point, generation);
        this.inFlight = request;
        await request;
        if (this.inFlight === request) this.inFlight = null;
      }
      if (generation !== this.generation) return;
      point = this.pendingPoint;
      this.pendingPoint = null;
    }
  }

  private async publish(point: GpsPoint, generation: number) {
    const sentAt = Date.now();
    try {
      await this.port.publish(point);
      if (generation === this.generation) {
        this.lastPublishedPoint = point;
        // Cadence is measured between confirmed sends, not ACK latency plus
        // 60 s (which could push a 30 s browser sampler to a 90 s gap).
        this.lastPublishedAt = sentAt;
        this.diagnose("send_ack");
        this.emit({
          state: "tracking",
          detail: "La API ha confirmado la ubicación de este dispositivo.",
          lastAckAt: Date.now(),
          autoRetryAllowed: true,
        });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.diagnose("send_error");
      if (error instanceof RiderGpsAuthorizationError) this.stop();
      this.emit({
        state: "error",
        detail: error instanceof Error ? error.message : "No se pudo enviar la ubicación.",
        autoRetryAllowed: !(error instanceof RiderGpsAuthorizationError),
      });
    }
  }
}
