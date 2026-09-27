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
  250, 120, 250, 120, 350, 120, 350, 120, 450, 120, 450, 120, 550, 120, 550,
  120, 650, 120, 650,
];

function browserEnvironment(): RiderAlertEnvironment {
  return {
    window: typeof window === "undefined" ? undefined : window,
    navigator: typeof navigator === "undefined" ? undefined : navigator,
  };
}

/**
 * Creates/resumes the context during a rider action (for example, starting a
 * shift) so subsequent offer alerts are allowed by mobile browsers.
 */
export function primeRiderOrderAudio(
  audioContextRef: { current: RiderAlertAudioContext | null },
  environment: RiderAlertEnvironment = browserEnvironment(),
): RiderAlertAudioContext | null {
  try {
    const AudioContextCtor =
      environment.window?.AudioContext ??
      environment.window?.webkitAudioContext;
    if (!AudioContextCtor) return null;

    const audio = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = audio;
    void audio.resume().catch(() => undefined);
    return audio;
  } catch {
    return null;
  }
}

/**
 * Schedules the audible alert and requests haptic feedback independently.
 * A browser that blocks or lacks Web Audio must never suppress vibration.
 */
export function playRiderOrderAlert(
  audioContextRef: { current: RiderAlertAudioContext | null },
  environment: RiderAlertEnvironment = browserEnvironment(),
): { soundScheduled: boolean; vibrationRequested: boolean } {
  let soundScheduled = false;
  const audio = primeRiderOrderAudio(audioContextRef, environment);

  if (audio) {
    try {
      const now = audio.currentTime;
      Array.from({ length: 20 }, (_, index) => index * 0.5).forEach(
        (offset, index) => {
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.type = index % 4 === 0 ? "triangle" : "sine";
          oscillator.frequency.value = 660 + index * 58;
          gain.gain.setValueAtTime(0.0001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.32, now + offset + 0.04);
          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            now + offset + 0.42,
          );
          oscillator.connect(gain);
          gain.connect(audio.destination);
          oscillator.start(now + offset);
          oscillator.stop(now + offset + 0.45);
        },
      );
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
