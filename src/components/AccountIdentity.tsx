import { useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, UserRound } from "lucide-react";
import { employeeDisplayName, employeeRoleDetails, ownRasterPhoto, type EmployeeIdentity } from "../accountIdentity";
import { PROFILE_PHOTO_ACCEPT } from "../profilePhoto";
import "../account-identity.css";

type IdentityProps = { identity: EmployeeIdentity | null };

export function ProfilePhoto({ identity }: IdentityProps) {
  const photo = ownRasterPhoto(identity?.photoUrl);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  return <span className="account-photo">
    {photo && photo !== failedPhoto
      ? <img src={photo} alt={`Foto propia de ${employeeDisplayName(identity)}`} onError={() => setFailedPhoto(photo)} />
      : <><UserRound size={22} aria-hidden="true" /><span>Sin foto</span></>}
  </span>;
}

export default function AccountIdentity({ identity }: IdentityProps) {
  return <div className="account-identity" aria-label="Identidad de mi cuenta">
    <ProfilePhoto key={identity?.id || "no-account"} identity={identity} />
    <div className="account-identity-copy">
      <strong className="account-identity-name">{employeeDisplayName(identity)}</strong>
      <span className="account-identity-role">{employeeRoleDetails(identity)}</span>
    </div>
  </div>;
}

export function OwnPhotoAction({ identity, busy, error, onSelect, onRemove }: IdentityProps & {
  busy: boolean;
  error: string;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const label = identity?.photoUrl ? "Cambiar foto propia" : "Añadir foto propia";
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onSelect(file);
  };
  return <div className="own-photo-actions" aria-busy={busy}>
    <input ref={input} className="own-photo-input" type="file" accept={PROFILE_PHOTO_ACCEPT} aria-label={label} onChange={choose} disabled={busy || !identity} tabIndex={-1} />
    <button type="button" className="own-photo-action" onClick={() => input.current?.click()} disabled={busy || !identity}>
      <ImagePlus size={16} aria-hidden="true" /> {busy ? "Guardando foto…" : label}
    </button>
    {identity?.photoUrl && <button type="button" className="own-photo-remove" onClick={onRemove} disabled={busy}>Quitar foto propia</button>}
    {error && <span className="own-photo-error" role="alert">{error}</span>}
  </div>;
}
