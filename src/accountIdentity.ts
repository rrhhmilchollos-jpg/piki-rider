export type EmployeeIdentity = {
  id: string;
  name: string;
  fullName: string;
  jobRole: string;
  role: string;
  photoUrl: string | null;
};

export type RiderSessionPayload = {
  employee?: Partial<EmployeeIdentity> | null;
  rider?: { id?: string; name?: string; email?: string; riderCode?: string; status?: string };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Use only canonical employee fields. Never guess a role from the app or ACLs. */
export function parseEmployeeIdentity(payload: RiderSessionPayload): EmployeeIdentity | null {
  const employee = payload.employee;
  if (!employee || !text(employee.id)) return null;
  const name = text(employee.name);
  return {
    id: text(employee.id),
    name,
    fullName: text(employee.fullName) || name,
    jobRole: text(employee.jobRole),
    role: text(employee.role),
    photoUrl: ownRasterPhoto(employee.photoUrl),
  };
}

/** Raster data URLs or existing HTTPS raster profile assets; no SVG/avatar generators. */
export function ownRasterPhoto(value: unknown): string | null {
  const photo = text(value);
  if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(photo)) return photo;
  try {
    const url = new URL(photo);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (/dicebear|ui-avatars|robohash|pravatar|randomuser/i.test(url.hostname)) return null;
    return /\.(?:jpe?g|png|webp)$/i.test(url.pathname) ? photo : null;
  } catch {
    return null;
  }
}

export function employeeDisplayName(identity: EmployeeIdentity | null): string {
  return identity?.fullName || identity?.name || "Nombre no disponible";
}

export function employeeRoleDetails(identity: EmployeeIdentity | null): string {
  return `Puesto: ${identity?.jobRole || "No disponible"} · Rol activo: ${identity?.role || "No disponible"}`;
}

type IdentityTicket = { token: string; generation: number; revision: number };
export type PhotoUpdateTicket = IdentityTicket & { employeeId: string };

/** In-memory, session-scoped identity; tokens/photos are never persisted here. */
export class AccountIdentitySession {
  private token: string;
  private generation = 0;
  private revision = 0;
  private photoPending = false;
  private identity: EmployeeIdentity | null = null;
  private listeners = new Set<() => void>();

  constructor(token: string) { this.token = token; }
  getSnapshot = (): EmployeeIdentity | null => this.identity;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private emit() { this.listeners.forEach((listener) => listener()); }
  clearIdentity() {
    this.generation += 1;
    this.revision += 1;
    this.photoPending = false;
    this.identity = null;
    this.emit();
  }
  changeSession(token: string) {
    this.token = token;
    this.clearIdentity();
  }
  beginRead(): IdentityTicket {
    return { token: this.token, generation: this.generation, revision: this.revision };
  }
  private current(ticket: IdentityTicket): boolean {
    return Boolean(this.token) && ticket.token === this.token
      && ticket.generation === this.generation && ticket.revision === this.revision;
  }
  mayApplyRead(ticket: IdentityTicket): boolean { return this.current(ticket); }
  applyRead(ticket: IdentityTicket, next: EmployeeIdentity | null): boolean {
    if (!this.current(ticket)) return false;
    const accountChanged = this.identity?.id !== next?.id;
    if (accountChanged) {
      // A new employee under the same credential also invalidates photo ACKs.
      this.generation += 1;
      this.revision += 1;
      this.photoPending = false;
    } else if (this.photoPending) return false;
    this.identity = next;
    this.emit();
    return true;
  }
  beginPhotoUpdate(): PhotoUpdateTicket | null {
    if (!this.identity || !this.token || this.photoPending) return null;
    this.revision += 1; // Reads started before this write may not undo its ACK.
    this.photoPending = true;
    return { ...this.beginRead(), employeeId: this.identity.id };
  }
  isCurrentPhotoUpdate(ticket: PhotoUpdateTicket): boolean {
    return this.current(ticket) && ticket.employeeId === this.identity?.id && this.photoPending;
  }
  finishPhotoUpdate(ticket: PhotoUpdateTicket, photoUrl?: string | null): boolean {
    if (!this.isCurrentPhotoUpdate(ticket)) return false;
    this.photoPending = false;
    this.revision += 1; // Ignore reads started while the upload was pending too.
    if (photoUrl !== undefined && this.identity) this.identity = { ...this.identity, photoUrl };
    this.emit();
    return true;
  }
}
