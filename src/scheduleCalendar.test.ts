import { describe, expect, it } from "vitest";
import {
  buildMadridScheduleWeek,
  getMadridWeekStart,
  madridDateKey,
} from "./scheduleCalendar";

describe("calendario de horarios en Europe/Madrid", () => {
  it("calcula la semana de lunes a domingo de la fecha actual de España", () => {
    const week = buildMadridScheduleWeek(new Date("2026-11-02T10:00:00.000Z"));

    expect(week.start).toBe("2026-11-02");
    expect(week.end).toBe("2026-11-08");
    expect(week.days.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(week.days[0]).toMatchObject({ day: "Lunes", isToday: true });
    expect(week.days[6]).toMatchObject({ day: "Domingo", isToday: false });
  });

  it("permite avanzar al menos cuatro semanas desde la semana actual", () => {
    const week = buildMadridScheduleWeek(new Date("2026-11-02T10:00:00.000Z"), 4);

    expect(week.start).toBe("2026-11-30");
    expect(week.end).toBe("2026-12-06");
  });

  it("mantiene lunes y domingo correctos al cruzar de mes", () => {
    const week = buildMadridScheduleWeek(new Date("2026-11-01T12:00:00.000Z"));

    expect(week.start).toBe("2026-10-26");
    expect(week.end).toBe("2026-11-01");
    expect(week.days[0].day).toBe("Lunes");
    expect(week.days[6].day).toBe("Domingo");
  });

  it("mantiene lunes y domingo correctos al cruzar de año", () => {
    const week = buildMadridScheduleWeek(new Date("2027-01-01T12:00:00.000Z"));

    expect(week.start).toBe("2026-12-28");
    expect(week.end).toBe("2027-01-03");
  });

  it("usa la fecha civil de Madrid aunque UTC aún sea el día anterior", () => {
    const instant = new Date("2026-11-01T23:30:00.000Z");

    expect(madridDateKey(instant)).toBe("2026-11-02");
    expect(getMadridWeekStart(instant)).toBe("2026-11-02");
  });
});
