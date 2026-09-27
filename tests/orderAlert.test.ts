import { describe, expect, it, vi } from "vitest";
import {
  playRiderOrderAlert,
  riderOrderVibrationPattern,
  type RiderAlertAudioContext,
  type RiderAlertAudioContextConstructor,
} from "../src/orderAlert";

function createAudioContext() {
  const oscillators: Array<{
    frequency: { value: number };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const createOscillator = vi.fn(() => {
    const oscillator = {
      type: "sine",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    oscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  });
  const createGain = vi.fn(
    () =>
      ({
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }) as unknown as GainNode,
  );

  return {
    context: {
      currentTime: 10,
      destination: {},
      resume: vi.fn(async () => undefined),
      createOscillator,
      createGain,
    } as unknown as RiderAlertAudioContext,
    oscillators,
  };
}

describe("rider order alerts", () => {
  it("schedules the full sound sequence and requests the vibration pattern", () => {
    const { context, oscillators } = createAudioContext();
    const AudioContext = vi.fn(function FakeAudioContext() {
      return context;
    });
    const vibrate = vi.fn(() => true);
    const audioRef: { current: RiderAlertAudioContext | null } = {
      current: null,
    };

    const result = playRiderOrderAlert(audioRef, {
      window: {
        AudioContext: AudioContext as unknown as RiderAlertAudioContextConstructor,
      },
      navigator: { vibrate },
    });

    expect(result).toEqual({ soundScheduled: true, vibrationRequested: true });
    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(20);
    expect(oscillators[0].frequency.value).toBe(660);
    expect(oscillators[19].frequency.value).toBe(1762);
    expect(oscillators[0].start).toHaveBeenCalledWith(10);
    expect(oscillators[19].stop).toHaveBeenCalledWith(19.95);
    expect(vibrate).toHaveBeenCalledWith(riderOrderVibrationPattern);
  });

  it("still requests vibration when Web Audio is unavailable", () => {
    const vibrate = vi.fn(() => true);
    const result = playRiderOrderAlert(
      { current: null },
      { window: {}, navigator: { vibrate } },
    );

    expect(result).toEqual({ soundScheduled: false, vibrationRequested: true });
    expect(vibrate).toHaveBeenCalledWith(riderOrderVibrationPattern);
  });

  it("keeps vibration independent when AudioContext construction fails", () => {
    const vibrate = vi.fn(() => true);
    const BrokenAudioContext = function BrokenAudioContext() {
      throw new Error("audio unavailable");
    } as unknown as RiderAlertAudioContextConstructor;

    const result = playRiderOrderAlert(
      { current: null },
      { window: { AudioContext: BrokenAudioContext }, navigator: { vibrate } },
    );

    expect(result).toEqual({ soundScheduled: false, vibrationRequested: true });
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
