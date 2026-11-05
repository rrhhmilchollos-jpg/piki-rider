import { describe, expect, it } from "vitest";
import { madridInstant, SHIFT_CHANNEL_ID, SHIFT_SOUND_NAME } from "./shiftStartAlarms";

describe("madridInstant", () => {
  it("mapea la hora de invierno con un desfase de +1", () => {
    expect(madridInstant("2026-11-05", "08:00")?.toISOString()).toBe("2026-11-05T07:00:00.000Z");
  });

  it("mapea la hora de verano con un desfase de +2", () => {
    expect(madridInstant("2026-07-15", "08:00")?.toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });

  it("rechaza fechas u horas mal formadas sin lanzar", () => {
    expect(madridInstant("05/11/2026", "08:00")).toBeNull();
    expect(madridInstant("2026-11-05", "8")).toBeNull();
  });

  it("mantiene la identidad del canal y del recurso de audio", () => {
    expect(SHIFT_CHANNEL_ID).toBe("piki_shift_start");
    expect(SHIFT_SOUND_NAME).toBe("start_shift");
  });
});
