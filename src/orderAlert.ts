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

function playAsset(assetName: string): boolean {
  if (typeof window === "undefined" || typeof Audio === "undefined") return false;
  try {
    const audio = new Audio(`/sounds/${assetName}`);
    audio.volume = 0.82;
    void audio.play().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Creates/resumes the context during a rider action so later mobile alerts are allowed. */
export function primeRiderOrderAudio(
  audioContextRef: { current: RiderAlertAudioContext | null },
  environment: RiderAlertEnvironment = browserEnvironment(),
): RiderAlertAudioContext | null {
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

export function playRiderShiftStart(): boolean {
  return playAsset("piki-alert-15s.mp3");
}

export function playRiderOrderCancelled(): boolean {
  return playAsset("ui-order-cancelled.mp3");
}

/** Plays the original PIKI assignment sound and keeps Web Audio/vibration as fallback. */
export function playRiderOrderAlert(
  audioContextRef: { current: RiderAlertAudioContext | null },
  environment: RiderAlertEnvironment = browserEnvironment(),
): { soundScheduled: boolean; vibrationRequested: boolean } {
  const assetPlayed = playAsset("piki-order-voice-15s.mp3");
  let soundScheduled = assetPlayed;
  const audio = assetPlayed ? null : primeRiderOrderAudio(audioContextRef, environment);

  if (audio) {
    try {
      const now = audio.currentTime;
      [0, 0.18, 0.36, 0.9, 1.08, 1.26].forEach((offset, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index % 3 === 2 ? 880 : 740;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.32, now + offset + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.13);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.16);
      });
      soundScheduled = true;
    } catch {
      /* The device may block or interrupt audio; continue with haptics. */
    }
  }

  let vibrationRequested = false;
  try {
    if (typeof environment.navigator?.vibrate === "function") {
      environment.navigator.vibrate(riderOrderVibrationPattern);
      vibrationRequested = true;
    }
  } catch {
    /* Haptics are optional and may be blocked by a device/browser. */
  }
  return { soundScheduled, vibrationRequested };
}
