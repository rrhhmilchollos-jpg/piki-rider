import { describe, expect, it } from "vitest";
import { getRiderOrderProgress } from "./orderProgress";

describe("progreso del pedido Rider", () => {
  it("mantiene la recogida como paso actual hasta confirmarla", () => {
    expect(getRiderOrderProgress("ready_for_pickup")).toEqual({
      pickup: "current",
      route: "upcoming",
      delivery: "upcoming",
    });
  });

  it.each(["picked_up", "on_the_way"] as const)(
    "marca la ruta como actual después de recoger (%s) sin completar la entrega",
    (status) => {
      expect(getRiderOrderProgress(status)).toEqual({
        pickup: "done",
        route: "current",
        delivery: "upcoming",
      });
    },
  );
});
