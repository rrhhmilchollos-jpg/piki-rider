const soundCache = new Map<string, HTMLAudioElement>();

function getAudio(path: string) {
  if (typeof window === "undefined") return null;
  const cached = soundCache.get(path);
  if (cached) return cached;
  const audio = new Audio(path);
  audio.preload = "auto";
  soundCache.set(path, audio);
  return audio;
}

export function playPikiUiSound(path: string, fallback?: () => void) {
  try {
    const audio = getAudio(path);
    if (!audio) return fallback?.();
    audio.currentTime = 0;
    void audio.play().catch(() => fallback?.());
  } catch {
    fallback?.();
  }
}
