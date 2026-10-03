import { Activity, Bell, CalendarDays, ClipboardList, Gift, LayoutDashboard, LifeBuoy, MapPinned, Settings, WalletCards, type LucideIcon } from "lucide-react";

type Props = {
  section: string;
  open: boolean;
  status: "checking" | "ready" | "unavailable";
  onNavigate: (section: string) => void;
  onClose: () => void;
};

type Group = { label: string; items: Array<[string, LucideIcon]> };

const groups: Group[] = [
  { label: "OPERACIÓN", items: [["Inicio", LayoutDashboard], ["Ofertas", Bell], ["Entregas", ClipboardList], ["Mapa", MapPinned]] },
  { label: "JORNADA", items: [["Horarios", CalendarDays], ["Incentivos", Gift]] },
  { label: "FINANZAS", items: [["Cartera", WalletCards], ["Estadísticas", Activity]] },
  { label: "AYUDA Y CUENTA", items: [["Soporte", LifeBuoy], ["Cuenta", Settings]] },
];

export default function RiderNavigation({ section, open, status, onNavigate, onClose }: Props) {
  return <aside className={`sidebar ${open ? "sidebar-open" : ""}`} aria-label="Navegación principal">
    <div className="brand-block">
      <img className="brand-mark brand-logo" src="/piki-mascot.png" alt="PIKI" />
      <div><strong>piki</strong><span>Riders</span></div>
      <button className="close-menu" onClick={onClose} aria-label="Cerrar menú">×</button>
    </div>
    <nav className="nav-list">
      {groups.map((group) => <div className="nav-group" key={group.label}>
        <p className="nav-label">{group.label}</p>
        {group.items.map(([label, Icon]) => <button key={label} className={`nav-item ${section === label ? "nav-item-active" : ""}`} onClick={() => onNavigate(label)} aria-current={section === label ? "page" : undefined}>
          <Icon size={18} /><span>{label}</span>
        </button>)}
      </div>)}
    </nav>
    <div className="sidebar-footer"><div className="support-dot" /><div><strong>Red PIKI</strong><span>{status === "ready" ? "Conectada" : status === "checking" ? "Sincronizando" : "Revisar conexión"}</span></div></div>
  </aside>;
}
