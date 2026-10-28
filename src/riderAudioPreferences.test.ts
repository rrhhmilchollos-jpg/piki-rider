import { describe, expect, it } from "vitest";
import { clampRiderAlertVolume, defaultRiderAudioPreferences } from "./riderAudioPreferences";

describe("preferencias de audio Rider", () => {
  it("limita el volumen al rango permitido por el navegador", () => {
    expect(clampRiderAlertVolume(-1)).toBe(0);
    expect(clampRiderAlertVolume(0.42)).toBe(0.42);
    expect(clampRiderAlertVolume(3)).toBe(1);
  });

  it("usa un valor seguro si el volumen no es numérico", () => {
    expect(clampRiderAlertVolume(Number.NaN)).toBe(defaultRiderAudioPreferences.volume);
  });
});
