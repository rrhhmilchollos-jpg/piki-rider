import { describe, expect, it } from "vitest";
import { classifyNotificationCategory } from "./notificationCategories";

describe("classifyNotificationCategory", () => {
  it.each(["order", "order.rider_offer", "delivery.assignment", "operational", "pedido.asignado"])(
    "classifies %s as an order notification",
    (category) => expect(classifyNotificationCategory(category)).toBe("orders"),
  );

  it.each(["schedule", "rider.schedule_updated", "shift.reminder", "calendar.booking", "turno.proximo"])(
    "classifies %s as planning",
    (category) => expect(classifyNotificationCategory(category)).toBe("planning"),
  );

  it.each(["incentive", "rider.quest.progress", "earnings.multiplier", "order.tip_added", "reto.activo", "premio"])(
    "classifies %s as an incentive or earnings notification",
    (category) => expect(classifyNotificationCategory(category)).toBe("incentives"),
  );

  it.each(["support.message", "order.message", "chat.reply", "soporte.mensaje"])(
    "classifies %s as communication",
    (category) => expect(classifyNotificationCategory(category)).toBe("communication"),
  );

  it.each(["onboarding.document", "profile.updated", "compliance.legal", "account", "seguro", "puntuación"])(
    "classifies %s as an account notification",
    (category) => expect(classifyNotificationCategory(category)).toBe("account"),
  );

  it("keeps unknown categories visible as other", () => {
    expect(classifyNotificationCategory("future_event_type")).toBe("other");
    expect(classifyNotificationCategory(null)).toBe("other");
  });
});
