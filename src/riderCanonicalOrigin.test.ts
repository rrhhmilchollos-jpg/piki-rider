import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canonical Rider origin — local source only", () => {
  it("keeps the configured logo on the singular operational origin", () => {
    const config = readFileSync("app.config.ts", "utf8");
    expect(config).toContain('logoUrl: "https://rider.pikidelivery.com/piki-mascot.png"');
    expect(config).not.toContain("riders.pikidelivery.com");
  });
  it("points Chrome GPS instructions to the singular origin and preserves Android guidance", () => {
    const gate = readFileSync("src/GpsRequiredGate.tsx", "utf8");
    expect(gate).toContain("Ubicación → rider.pikidelivery.com → Permitir.");
    expect(gate).not.toContain("riders.pikidelivery.com");
    expect(gate).toContain("«Mientras se usa la aplicación»");
    expect(gate).toContain("«Ubicación precisa»");
  });
});
