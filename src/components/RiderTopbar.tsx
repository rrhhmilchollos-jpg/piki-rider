import { Bike, Headphones, Menu, Settings } from "lucide-react";
import NotificationCenter from "../NotificationCenter";
import AccountIdentity from "./AccountIdentity";
import type { EmployeeIdentity } from "../accountIdentity";

type Props = {
  apiOrigin: string;
  token: string;
  employeeIdentity?: EmployeeIdentity | null;
  profileOpen: boolean;
  onOpenMenu: () => void;
  onOpenSupport: () => void;
  onToggleProfile: () => void;
  onOpenAccount: () => void;
};

export default function RiderTopbar({ apiOrigin, token, employeeIdentity = null, profileOpen, onOpenMenu, onOpenSupport, onToggleProfile, onOpenAccount }: Props) {
  return <header className="topbar account-topbar">
    <button className="menu-button" onClick={onOpenMenu} aria-label="Abrir menú"><Menu size={21} /></button>
    <div className="location-pill"><Bike size={16} /><span>Operativa de reparto</span><span className="status-dot" /></div>
    <AccountIdentity identity={employeeIdentity} />
    <div className="topbar-actions">
      <NotificationCenter apiOrigin={apiOrigin} token={token} surface="rider" />
      <button className="icon-button" onClick={onOpenSupport} aria-label="Abrir soporte"><Headphones size={19} /></button>
      <div className="profile-wrap">
        <button className="profile-trigger" onClick={onToggleProfile} aria-expanded={profileOpen} aria-label="Abrir perfil"><Settings size={21} aria-hidden="true" /></button>
        {profileOpen && <div className="profile-menu"><AccountIdentity identity={employeeIdentity} /><span>Sesión operativa protegida</span><button onClick={onOpenAccount}>Ver mi cuenta</button></div>}
      </div>
    </div>
  </header>;
}
