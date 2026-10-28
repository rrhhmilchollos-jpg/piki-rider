export type PikiReleaseIdentity = {
  surface: string;
  version: string;
  buildId: string;
};

export type PikiStaticRelease = PikiReleaseIdentity & {
  minimumVersion?: unknown;
  forceUpdate?: unknown;
};

export type PikiReleasePolicy = {
  surface?: unknown;
  minimumVersion?: unknown;
  forceUpdate?: unknown;
  updateRequired?: unknown;
};

export type PikiPwaTarget = {
  version: string;
  buildId: string;
};

export type PikiWorkerPort = {
  state?: string;
  postMessage(message: unknown): void;
  addEventListener?(type: string, listener: EventListener): void;
  removeEventListener?(type: string, listener: EventListener): void;
};

export type PikiRegistrationPort = {
  waiting: PikiWorkerPort | null;
  installing: PikiWorkerPort | null;
  addEventListener?(type: string, listener: EventListener): void;
  removeEventListener?(type: string, listener: EventListener): void;
};

export type PikiWorkerContainerPort = {
  controller: PikiWorkerPort | null;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

export type PikiStoragePort = Pick<Storage, "getItem" | "setItem">;

export const PIKI_FOCUS_REFRESH_MS = 60_000;
export const PIKI_PERIODIC_REFRESH_MS = 5 * 60_000;

export function pikiVersionParts(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

export function isPikiVersionNewer(candidate: unknown, current: unknown): boolean {
  const left = pikiVersionParts(candidate);
  const right = pikiVersionParts(current);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

/** The static same-origin file is the only source that can announce a web build. */
export function isValidPikiStaticRelease(value: unknown, surface: string): value is PikiStaticRelease {
  if (!value || typeof value !== "object") return false;
  const release = value as Record<string, unknown>;
  return release.surface === surface
    && pikiVersionParts(release.version) !== null
    && typeof release.buildId === "string"
    && release.buildId.trim().length > 0;
}

/**
 * A matching static release is an update target only for the same surface. API
 * build identifiers are intentionally not consulted here: they may lag a CDN.
 */
export function getPikiWebTarget(value: unknown, current: PikiReleaseIdentity): PikiPwaTarget | null {
  if (!isValidPikiStaticRelease(value, current.surface)) return null;
  if (value.buildId === current.buildId) return null;
  return { version: value.version, buildId: value.buildId };
}

/** API policy protects compatibility; it cannot alone advertise a web build. */
export function apiRequiresPikiSecurityUpdate(value: PikiReleasePolicy, current: PikiReleaseIdentity): boolean {
  return value.surface === current.surface
    && value.forceUpdate === true
    && (value.updateRequired === true || isPikiVersionNewer(value.minimumVersion, current.version));
}

export function pikiReleaseUrl(origin: string, cacheBuster: string | number): string {
  const url = new URL("/release.json", origin);
  url.searchParams.set("piki_release", String(cacheBuster));
  return url.toString();
}

export async function fetchPikiStaticRelease(
  fetcher: typeof fetch,
  origin: string,
  surface: string,
  cacheBuster: string | number = Date.now(),
): Promise<PikiStaticRelease> {
  const url = pikiReleaseUrl(origin, cacheBuster);
  const response = await fetcher(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!response.ok) throw new Error(`RELEASE_CHECK_${response.status}`);
  const release: unknown = await response.json();
  if (!isValidPikiStaticRelease(release, surface)) throw new Error("El release web no corresponde a esta superficie.");
  return release;
}

export function pikiReloadMarker(surface: string, targetBuildId: string): string {
  return `piki-pwa-reload:${surface}:${targetBuildId}`;
}

/** Storage writes are deliberately limited to a build-scoped reload marker. */
export function canNavigateToPikiTarget(input: {
  target: PikiPwaTarget | null;
  current: PikiReleaseIdentity;
  online: boolean;
  safe: boolean;
  storage: PikiStoragePort;
  manualRetry?: boolean;
}): boolean {
  if (!input.target || input.target.buildId === input.current.buildId || !input.online || !input.safe) return false;
  return input.manualRetry === true || input.storage.getItem(pikiReloadMarker(input.current.surface, input.target.buildId)) !== "1";
}

export function markPikiTargetNavigation(storage: PikiStoragePort, surface: string, targetBuildId: string): void {
  storage.setItem(pikiReloadMarker(surface, targetBuildId), "1");
}

export function pikiTargetNavigationUrl(href: string, targetBuildId: string): string {
  const url = new URL(href);
  url.searchParams.set("piki_build", targetBuildId);
  return url.toString();
}

/** Native assets belong to the signed container, never to this web updater. */
export function isPikiNativePwaGuard(isNativePlatform: boolean): boolean {
  return isNativePlatform;
}

export function shouldCheckPikiVersion(input: {
  now: number;
  lastCheckedAt: number;
  visible: boolean;
  reason: "initial" | "focus" | "visible" | "interval" | "manual" | "critical";
  needsDeferredActivation: boolean;
}): boolean {
  // GPS POSTs can emit critical-operation events frequently. They only unlock
  // a pending activation; they never fetch release metadata.
  if (input.reason === "critical") return false;
  if (input.reason === "initial") return true;
  if (input.reason === "manual") return input.visible;
  if (!input.visible) return false;
  if (input.reason === "interval") return input.now - input.lastCheckedAt >= PIKI_PERIODIC_REFRESH_MS;
  return input.needsDeferredActivation || input.now - input.lastCheckedAt >= PIKI_FOCUS_REFRESH_MS;
}

export async function waitForPikiWaitingWorker(
  registration: PikiRegistrationPort,
  timeoutMs = 10_000,
): Promise<PikiWorkerPort | null> {
  if (registration.waiting) return registration.waiting;
  return await new Promise((resolve) => {
    let settled = false;
    let installing: PikiWorkerPort | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (worker: PikiWorkerPort | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      registration.removeEventListener?.("updatefound", inspect as EventListener);
      installing?.removeEventListener?.("statechange", inspect as EventListener);
      resolve(worker);
    };
    const inspect = () => {
      if (registration.waiting) return finish(registration.waiting);
      const next = registration.installing;
      if (next !== installing) {
        installing?.removeEventListener?.("statechange", inspect as EventListener);
        installing = next;
        installing?.addEventListener?.("statechange", inspect as EventListener);
      }
      if (installing?.state === "redundant") finish(null);
    };
    registration.addEventListener?.("updatefound", inspect as EventListener);
    inspect();
    timer = setTimeout(() => finish(registration.waiting), timeoutMs);
  });
}

export async function waitForPikiControllerChange(
  container: PikiWorkerContainerPort,
  previousController: PikiWorkerPort | null,
  timeoutMs = 10_000,
): Promise<boolean> {
  if (container.controller && container.controller !== previousController) return true;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (changed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      container.removeEventListener("controllerchange", onChange as EventListener);
      resolve(changed);
    };
    const onChange = () => finish(container.controller !== previousController);
    const timer = setTimeout(() => finish(false), timeoutMs);
    container.addEventListener("controllerchange", onChange as EventListener);
  });
}

/**
 * StrictMode, focus and an explicit click may all request a check together. This
 * small primitive guarantees one in-flight request without retaining failures.
 */
export function pikiSingleFlight<T>(create: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    inFlight = create().finally(() => { inFlight = null; });
    return inFlight;
  };
}
