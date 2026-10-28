export type RiderAudioPreferences = {
  alertsEnabled: boolean;
  volume: number;
};

export const defaultRiderAudioPreferences: RiderAudioPreferences = {
  alertsEnabled: false,
  volume: 0.7,
};

function storageKey(riderId: string) {
  return `piki-${location.hostname}-rider-audio-${encodeURIComponent(riderId.trim())}`;
}

export function clampRiderAlertVolume(value: number): number {
  if (!Number.isFinite(value)) return defaultRiderAudioPreferences.volume;
  return Math.min(1, Math.max(0, value));
}

function normalize(input: Partial<RiderAudioPreferences> | null | undefined): RiderAudioPreferences {
  return {
    alertsEnabled: input?.alertsEnabled === true,
    volume: clampRiderAlertVolume(Number(input?.volume)),
  };
}

/** Preferences are keyed by the authenticated Rider; a consent is never reused by another identity. */
export function loadRiderAudioPreferences(riderId: string): RiderAudioPreferences {
  if (!riderId.trim()) return defaultRiderAudioPreferences;
  try {
    const raw = localStorage.getItem(storageKey(riderId));
    if (!raw) return defaultRiderAudioPreferences;
    return normalize(JSON.parse(raw) as Partial<RiderAudioPreferences>);
  } catch {
    return defaultRiderAudioPreferences;
  }
}

export function saveRiderAudioPreferences(riderId: string, preferences: RiderAudioPreferences): RiderAudioPreferences {
  const normalized = normalize(preferences);
  if (!riderId.trim()) return normalized;
  try {
    localStorage.setItem(storageKey(riderId), JSON.stringify(normalized));
  } catch {
    // Storage is optional; the current session still uses the selected value.
  }
  return normalized;
}
