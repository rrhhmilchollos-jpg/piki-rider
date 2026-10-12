import { describe, expect, it } from "vitest";
import {
  canAccessSectionWithoutLocation,
  shouldShowOperationalMap,
  shouldTrackLocationOnOperationalMap,
} from "./riderSectionPolicy";

describe("política de mapa operativo Rider", () => {
  it("muestra el mapa únicamente en Inicio", () => {
    expect(shouldShowOperationalMap("Inicio")).toBe(true);
  });

  it("nunca muestra jornada ni mapa dentro de Cuenta", () => {
    expect(shouldShowOperationalMap("Cuenta")).toBe(false);
  });

  it("mantiene el mapa fuera de las secciones no operativas", () => {
    expect(shouldShowOperationalMap("Horarios")).toBe(false);
    expect(shouldShowOperationalMap("Soporte")).toBe(false);
  });

  it("permite abrir Cuenta y Soporte sin permiso GPS", () => {
    expect(canAccessSectionWithoutLocation("Cuenta")).toBe(true);
    expect(canAccessSectionWithoutLocation("Soporte")).toBe(true);
  });

  it("solo activa el tracking del mapa operativo durante una jornada", () => {
    expect(shouldTrackLocationOnOperationalMap("Inicio", false)).toBe(false);
    expect(shouldTrackLocationOnOperationalMap("Inicio", true)).toBe(true);
    expect(shouldTrackLocationOnOperationalMap("Cuenta", true)).toBe(false);
    expect(shouldTrackLocationOnOperationalMap("Soporte", true)).toBe(false);
  });
});
