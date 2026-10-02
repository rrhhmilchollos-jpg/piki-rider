import { PIKI_RELEASE } from "./release-meta";

export const RIDER_RELEASE_VERSION = PIKI_RELEASE.version;
export const RIDER_SURFACE = PIKI_RELEASE.surface;

export type ServedRelease = {
  version?: string;
  minimumVersion?: string;
  surface?: string;
};

function versionParts(value: string): number[] | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Returns a positive number when `left` is newer than `right`. */
export function compareReleaseVersions(left: string, right: string): number | null {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference) return difference;
  }
  return 0;
}

export function requiresRiderUpdate(release: ServedRelease): boolean {
  if (release.surface !== RIDER_SURFACE || !release.minimumVersion) return false;
  const comparison = compareReleaseVersions(release.minimumVersion, RIDER_RELEASE_VERSION);
  return comparison !== null && comparison > 0;
}

export async function fetchServedRiderRelease(): Promise<ServedRelease | null> {
  const response = await fetch("/release.json", { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const release = await response.json() as ServedRelease;
  return release.surface === RIDER_SURFACE ? release : null;
}
