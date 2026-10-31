export type NotificationGroupId =
  | "orders"
  | "planning"
  | "incentives"
  | "communication"
  | "account"
  | "other";

export const notificationGroups: Array<{ id: NotificationGroupId; label: string }> = [
  { id: "orders", label: "Pedidos" },
  { id: "planning", label: "Turnos" },
  { id: "incentives", label: "Incentivos" },
  { id: "communication", label: "Chat y soporte" },
  { id: "account", label: "Cuenta y documentos" },
  { id: "other", label: "Otros" },
];

const patterns: Array<[NotificationGroupId, RegExp]> = [
  ["incentives", /(^|[._-])(incentive|incentives|quest|challenge|multiplier|bonus|earning|payout|tip|reward|surge|demand|propina(s)?|premio(s)?|reto(s)?|multiplicador(es)?|ganancia(s)?)([._-]|$)/],
  ["communication", /(^|[._-])(support|message|chat|communication|soporte|mensaje(s)?|conversacion(es)?)([._-]|$)/],
  ["orders", /(^|[._-])(order|orders|delivery|assignment|offer|operational|pedido(s)?)([._-]|$)/],
  ["planning", /(^|[._-])(shift|schedule|agenda|booking|slot|calendar|turno(s)?|horario(s)?)([._-]|$)/],
  ["account", /(^|[._-])(account|profile|compliance|legal|document|onboarding|employee|verification|policy|insurance|tax|score|rating|cuenta|perfil|cumplimiento|documento(s)?|seguro(s)?|impuesto(s)?|puntuacion|valoracion)([._-]|$)/],
];

export function classifyNotificationCategory(category: unknown): NotificationGroupId {
  const normalized = String(category ?? "")
    .replace(/([a-z])([A-Z])/g, "$1.$2")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const [group, pattern] of patterns) {
    if (pattern.test(normalized)) return group;
  }
  return "other";
}

export function notificationCategoryLabel(group: NotificationGroupId): string {
  return notificationGroups.find((item) => item.id === group)?.label ?? "Otros";
}
