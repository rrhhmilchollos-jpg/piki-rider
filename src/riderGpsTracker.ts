import {
  shouldPublishRiderGpsFix,
  validGpsPoint,
  type GpsPoint,
} from "./riderGpsPolicy";

export type RiderGpsDiagnosticEvent = "watch_start" | "watch_stop" | "fix_received" | "send_ack" | "send_error";

export type GpsCallbacks = {
  onLocation: (point: GpsPoint) => void;
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
};

export class RiderGpsAuthorizationError extends Error {}

/**
 * Owns exactly one location watcher. A stopped or superseded generation cannot
 * publish, acknowledge, update the map, or update UI state again.
 */
export class RiderGpsTracker {
  private generation = 0;
  private watcher: string | null = null;
  private readonly pendingRemoval = new Set<string>();
  private inFlight: Promise<void> | null = null;
  private pendingPoint: GpsPoint | null = null;
  private lastPublishedPoint: GpsPoint | null = null;
  private lastPublishedAt = 0;
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

  async start() {
    const generation = ++this.generation;
    this.inFlight = null;
    this.pendingPoint = null;
    this.lastPublishedPoint = null;
    this.lastPublishedAt = 0;
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
          this.stop();
          this.emit({ state: "error", detail: error.message });
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

  private async receiveFix(point: GpsPoint, generation: number) {
    if (generation !== this.generation) return;
    this.diagnose("fix_received");
    if (!validGpsPoint(point)) {
      this.emit({ detail: "Posición descartada: precisión insuficiente o coordenadas no válidas." });
      return;
    }
    this.onFix?.(point);
    this.emit({ lastFixAt: Date.now(), accuracy: point.accuracy });
    if (this.inFlight) {
      // Preserve only the newest valid fix while the network request is active.
      this.pendingPoint = point;
      return;
    }
    await this.flushPendingFixes(point, generation);
  }

  private async flushPendingFixes(firstPoint: GpsPoint, generation: number) {
    let point: GpsPoint | null = firstPoint;
    while (point && generation === this.generation) {
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
    try {
      await this.port.publish(point);
      if (generation === this.generation) {
        this.lastPublishedPoint = point;
        this.lastPublishedAt = Date.now();
        this.diagnose("send_ack");
        this.emit({
          state: "tracking",
          detail: "La API ha confirmado la ubicación de este dispositivo.",
          lastAckAt: Date.now(),
        });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.diagnose("send_error");
      if (error instanceof RiderGpsAuthorizationError) this.stop();
      this.emit({
        state: "error",
        detail: error instanceof Error ? error.message : "No se pudo enviar la ubicación.",
      });
    }
  }
}
