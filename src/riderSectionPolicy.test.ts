import { describe, expect, it } from "vitest";
import { shouldShowOperationalMap } from "./riderSectionPolicy";

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
});
