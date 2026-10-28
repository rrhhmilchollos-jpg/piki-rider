import { clampRiderAlertVolume, type RiderAudioPreferences } from "./riderAudioPreferences";

export type RiderAlertAudioContext = {
  currentTime: number;
  destination: AudioDestinationNode;
  resume: () => Promise<void>;
  createOscillator: () => OscillatorNode;
  createGain: () => GainNode;
};

export type RiderAlertAudioContextConstructor = new () => RiderAlertAudioContext;

export type RiderAlertEnvironment = {
  window?: {
    AudioContext?: RiderAlertAudioContextConstructor;
    webkitAudioContext?: RiderAlertAudioContextConstructor;
  };
  navigator?: {
    vibrate?: (pattern: number | number[]) => boolean;
  };
};

export const riderOrderVibrationPattern = [
  180, 100, 180, 100, 180, 260, 320, 100, 320, 100, 320,
];

function browserEnvironment(): RiderAlertEnvironment {
  return {
    window: typeof window === "undefined" ? undefined : window,
    navigator: typeof navigator === "undefined" ? undefined : navigator,
  };
}

function allowed(preferences?: RiderAudioPreferences) {
  return preferences?.alertsEnabled === true;
}

function volumeOf(preferences?: RiderAudioPreferences) {
  return clampRiderAlertVolume(preferences?.volume ?? 0);
}

function playAsset(assetName: string, volume: number): boolean {
  if (typeof window === "undefined" || typeof Audio === "undefined") return false;
  try {
    const audio = new Audio(`/sounds/${assetName}`);
    // Browser volume is clamped to [0, 1]; this does not alter any OS volume limit.
    audio.volume = clampRiderAlertVolume(volume);
    audio.loop = false;
    audio.preload = "auto";
    void audio.play().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Creates/resumes the context during an explicit Rider action so later mobile alerts are allowed. */
export function primeRiderOrderAudio(
  audioContextRef: { current: RiderAlertAudioContext | null },
  preferences?: RiderAudioPreferences,
  environment: RiderAlertEnvironment = browserEnvironment(),
): RiderAlertAudioContext | null {
  if (!allowed(preferences)) return null;
  try {
    const AudioContextCtor = environment.window?.AudioContext ?? environment.window?.webkitAudioContext;
    if (!AudioContextCtor) return null;
    const audio = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = audio;
    void audio.resume().catch(() => undefined);
    return audio;
  } catch {
    return null;
  }
}

export function playRiderShiftStart(preferences?: RiderAudioPreferences): boolean {
  if (!allowed(preferences)) return false;
  const volume = volumeOf(preferences);
  return playAsset("ui-shift-start.mp3", volume) || playAsset("piki-alert-15s.mp3", volume);
}

export function playRiderOrderCancelled(preferences?: RiderAudioPreferences): boolean {
  return allowed(preferences) && playAsset("ui-order-cancelled.mp3", volumeOf(preferences));
}

/** Plays one finite assignment alert and optional haptics after the Rider has consented. */
export function playRiderOrderAlert(
  audioContextRef: { current: RiderAlertAudioContext | null },
  preferences?: RiderAudioPreferences,
  environment: RiderAlertEnvironment = browserEnvironment(),
): { soundScheduled: boolean; vibrationRequested: boolean } {
  if (!allowed(preferences)) return { soundScheduled: false, vibrationRequested: false };
  const volume = volumeOf(preferences);
  const assetPlayed = playAsset("piki-order-voice-15s.mp3", volume);
  let soundScheduled = assetPlayed;
  const audio = assetPlayed ? null : primeRiderOrderAudio(audioContextRef, preferences, environment);

  if (audio) {
    try {
      const now = audio.currentTime;
      [0, 0.18, 0.36, 0.9, 1.08, 1.26].forEach((offset, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index % 3 === 2 ? 880 : 740;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.32 * volume), now + offset + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.13);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.16);
      });
      soundScheduled = true;
    } catch {
      // The device may block or interrupt audio; continue with haptics.
    }
  }

  let vibrationRequested = false;
  try {
    if (typeof environment.navigator?.vibrate === "function") {
      environment.navigator.vibrate(riderOrderVibrationPattern);
      vibrationRequested = true;
    }
  } catch {
    // Haptics are optional and may be blocked by a device/browser.
  }
  return { soundScheduled, vibrationRequested };
}
