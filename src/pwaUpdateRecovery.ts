export type ReleaseIdentity = {
  version: string;
  buildId: string;
};

export type ReleasePolicy = {
  surface?: unknown;
  version?: unknown;
  minimumVersion?: unknown;
  buildId?: unknown;
  forceUpdate?: unknown;
  updateRequired?: unknown;
};

export type UpdateRequirement = {
  kind: "version" | "build";
  targetVersion: string;
  targetBuildId: string;
};

type ValidReleasePolicy = ReleasePolicy & {
  surface: string;
  minimumVersion: string;
  buildId: string;
  forceUpdate: boolean;
};

export type PwaOperationSafety = {
  known: boolean;
  active: boolean;
};

function versionParts(value: string): number[] | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

export function isNewerReleaseVersion(candidate: string, current: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(current);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export function isValidReleasePolicy(policy: ReleasePolicy, surface: string): policy is ValidReleasePolicy {
  return policy.surface === surface
    && typeof policy.minimumVersion === "string"
    && versionParts(policy.minimumVersion) !== null
    && typeof policy.buildId === "string"
    && typeof policy.forceUpdate === "boolean";
}

/**
 * A server-side `updateRequired` flag alone is intentionally not enough to reload.
 * Once the currently running version and build match the policy, treating that flag
 * as a reason again would cause an endless PWA reload loop.
 */
export function getRequiredPwaUpdate(policy: ReleasePolicy, current: ReleaseIdentity, surface: string): UpdateRequirement | null {
  if (!isValidReleasePolicy(policy, surface) || !policy.forceUpdate) return null;
  const targetVersion = typeof policy.version === "string" ? policy.version : policy.minimumVersion;
  if (isNewerReleaseVersion(policy.minimumVersion, current.version)) {
    return { kind: "version", targetVersion, targetBuildId: policy.buildId };
  }
  if (policy.buildId !== current.buildId) {
    return { kind: "build", targetVersion, targetBuildId: policy.buildId };
  }
  return null;
}

export function shouldDeferPwaActivation(safety: PwaOperationSafety): boolean {
  return !safety.known || safety.active;
}

export function canReloadAfterControllerChange(input: {
  activationRequested: boolean;
  safety: PwaOperationSafety;
  alreadyReloadedForTarget: boolean;
}): boolean {
  return input.activationRequested
    && !shouldDeferPwaActivation(input.safety)
    && !input.alreadyReloadedForTarget;
}

export function pwaReloadMarker(targetBuildId: string): string {
  return `piki-rider-pwa-reload:${targetBuildId}`;
}
