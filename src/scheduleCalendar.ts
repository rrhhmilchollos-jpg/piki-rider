export const MADRID_TIME_ZONE = "Europe/Madrid";

export type ScheduleCalendarDay = {
  date: string;
  day: string;
  displayDate: string;
  isToday: boolean;
};

export type ScheduleCalendarWeek = {
  start: string;
  end: string;
  days: ScheduleCalendarDay[];
};

const weekdayNames = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

const madridDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MADRID_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const scheduleDateFormatter = new Intl.DateTimeFormat("es-ES", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const weekRangeFormatter = new Intl.DateTimeFormat("es-ES", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function dateKeyFromParts(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function civilDateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function civilDateKey(date: Date): string {
  return dateKeyFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Fecha civil que se está viviendo en España, no la zona horaria del dispositivo. */
export function madridDateKey(reference = new Date()): string {
  const parts = madridDateFormatter.formatToParts(reference);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return dateKeyFromParts(Number(values.year), Number(values.month), Number(values.day));
}

/** Normaliza la fecha recibida de Fleet para cruzarla con una fecha civil del calendario. */
export function normalizeScheduleDate(value: string): string {
  const candidate = value.trim();
  const datePrefix = candidate.match(/^(\d{4}-\d{2}-\d{2})/);
  if (datePrefix && isValidDateKey(datePrefix[1])) return datePrefix[1];

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : madridDateKey(parsed);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  if (!isValidDateKey(dateKey)) throw new Error(`Fecha de calendario no válida: ${dateKey}`);
  const result = civilDateFromKey(dateKey);
  result.setUTCDate(result.getUTCDate() + days);
  return civilDateKey(result);
}

/** Lunes de la semana ISO que contiene la fecha de Madrid indicada. */
export function getMadridWeekStart(reference = new Date()): string {
  const today = madridDateKey(reference);
  const dayOfWeek = civilDateFromKey(today).getUTCDay() || 7;
  return addDaysToDateKey(today, 1 - dayOfWeek);
}

export function buildMadridScheduleWeek(
  reference = new Date(),
  weekOffset = 0,
): ScheduleCalendarWeek {
  const today = madridDateKey(reference);
  const start = addDaysToDateKey(getMadridWeekStart(reference), weekOffset * 7);
  const days = weekdayNames.map((day, index) => {
    const date = addDaysToDateKey(start, index);
    return {
      day,
      date,
      displayDate: scheduleDateFormatter.format(civilDateFromKey(date)),
      isToday: date === today,
    };
  });

  return { start, end: days[6].date, days };
}

export function formatScheduleWeekRange(week: Pick<ScheduleCalendarWeek, "start" | "end">): string {
  return `Del ${weekRangeFormatter.format(civilDateFromKey(week.start))} al ${weekRangeFormatter.format(civilDateFromKey(week.end))}`;
}
