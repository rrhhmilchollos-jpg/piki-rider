import { describe, expect, it, vi } from "vitest";
import { AccountIdentitySession, employeeDisplayName, employeeRoleDetails, ownRasterPhoto, parseEmployeeIdentity, type EmployeeIdentity } from "./accountIdentity";

const photo = "data:image/jpeg;base64,YWJj";
function employee(id = "employee-1"): EmployeeIdentity {
  return { id, name: "Nombre canónico", fullName: "María del Carmen García Fernández de la Torre", jobRole: "fleet_coordinator", role: "support", photoUrl: photo };
}
function session() {
  const state = new AccountIdentitySession("token-A");
  state.applyRead(state.beginRead(), employee());
  return state;
}

describe("canonical employee identity", () => {
  it("uses fullName, assigned jobRole and active role rather than rider/name or primaryRole", () => {
    const payload = { employee: { ...employee(), primaryRole: "admin" }, rider: { id: "rider-1", name: "Alias operativo" } };
    const identity = parseEmployeeIdentity(payload);
    expect(identity).toEqual(employee());
    expect(employeeDisplayName(identity)).toBe(employee().fullName);
    expect(employeeRoleDetails(identity)).toBe("Puesto: fleet_coordinator · Rol activo: support");
    expect(employeeRoleDetails(identity)).not.toMatch(/admin|Rider/);
  });
  it("falls back only to canonical name, never infers a job or role", () => {
    const identity = parseEmployeeIdentity({ employee: { id: "employee-1", name: "Nombre y apellidos reales" }, rider: { name: "No usar" } });
    expect(identity?.fullName).toBe("Nombre y apellidos reales");
    expect(identity?.photoUrl).toBeNull();
    expect(employeeRoleDetails(identity)).toBe("Puesto: No disponible · Rol activo: No disponible");
  });
  it("preserves unknown assigned and active role codes without inventing a label", () => {
    const identity = parseEmployeeIdentity({ employee: { ...employee(), jobRole: "bespoke_fleet_2026", role: "special_active_2026" } });
    expect(employeeRoleDetails(identity)).toContain("bespoke_fleet_2026");
    expect(employeeRoleDetails(identity)).toContain("special_active_2026");
  });
  it("does not use an operational rider as an employee identity when the API is old", () => {
    expect(parseEmployeeIdentity({ rider: { id: "rider-1", name: "Alias operativo" } })).toBeNull();
    expect(parseEmployeeIdentity({ employee: { name: "Sin id" } })).toBeNull();
    expect(employeeDisplayName(null)).toBe("Nombre no disponible");
  });
  it.each([null, "", "data:image/svg+xml;base64,YWJj", "https://api.dicebear.com/9.x/personas/png", "https://i.pravatar.cc/avatar.png", "javascript:alert(1)", "https://example.invalid/a.svg", "http://example.invalid/real.jpg"])("rejects absent or non-own/raster image %s", (url) => {
    expect(ownRasterPhoto(url)).toBeNull();
  });
  it.each([photo, "data:image/png;base64,YWJj", "data:image/webp;base64,YWJj", "https://storage.invalid/own-profile.jpeg?version=2"])("accepts real raster source %s", (url) => {
    expect(ownRasterPhoto(url)).toBe(url);
  });
});

describe("session-scoped identity and photo ACK", () => {
  it.each(["token-B", ""])("clears synchronously on session change to %s and rejects late reads and ACKs", (token) => {
    const state = session();
    const notify = vi.fn();
    state.subscribe(notify);
    const oldRead = state.beginRead();
    const pendingPhoto = state.beginPhotoUpdate()!;
    state.changeSession(token);
    expect(state.getSnapshot()).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(state.applyRead(oldRead, employee())).toBe(false);
    expect(state.finishPhotoUpdate(pendingPhoto, photo)).toBe(false);
    expect(state.getSnapshot()).toBeNull();
    if (token) {
      expect(state.applyRead(state.beginRead(), employee("employee-B"))).toBe(true);
      expect(state.getSnapshot()?.id).toBe("employee-B");
      expect(state.finishPhotoUpdate(pendingPhoto, photo)).toBe(false);
    }
  });
  it("cannot revive old identity after A → B → A token changes", () => {
    const state = session();
    const oldRead = state.beginRead();
    state.changeSession("token-B");
    state.changeSession("token-A");
    expect(state.applyRead(oldRead, employee())).toBe(false);
  });
  it("immediately clears on auth error and ignores reads that started before it", () => {
    const state = session();
    const oldRead = state.beginRead();
    expect(state.mayApplyRead(oldRead)).toBe(true);
    state.clearIdentity();
    expect(state.getSnapshot()).toBeNull();
    expect(state.mayApplyRead(oldRead)).toBe(false);
    expect(state.applyRead(oldRead, employee())).toBe(false);
  });
  it("holds the current image until ACK and ignores polls before/during mutation", () => {
    const state = session();
    const beforeUpload = state.beginRead();
    const pending = state.beginPhotoUpdate()!;
    const duringUpload = state.beginRead();
    expect(state.getSnapshot()?.photoUrl).toBe(photo);
    expect(state.beginPhotoUpdate()).toBeNull();
    expect(state.applyRead(beforeUpload, { ...employee(), photoUrl: null })).toBe(false);
    expect(state.applyRead(duringUpload, { ...employee(), photoUrl: null })).toBe(false);
    expect(state.finishPhotoUpdate(pending, "data:image/jpeg;base64,ZGVm")).toBe(true);
    expect(state.getSnapshot()?.photoUrl).toBe("data:image/jpeg;base64,ZGVm");
    expect(state.applyRead(duringUpload, employee())).toBe(false);
    expect(state.finishPhotoUpdate(pending, photo)).toBe(false);
  });
  it("keeps the confirmed image on upload failure and removes only after a null ACK", () => {
    const state = session();
    expect(state.finishPhotoUpdate(state.beginPhotoUpdate()!)).toBe(true);
    expect(state.getSnapshot()?.photoUrl).toBe(photo);
    expect(state.finishPhotoUpdate(state.beginPhotoUpdate()!, null)).toBe(true);
    expect(state.getSnapshot()?.photoUrl).toBeNull();
  });
  it("invalidates pending uploads when employee changes under the same token", () => {
    const state = session();
    const pending = state.beginPhotoUpdate()!;
    expect(state.applyRead(state.beginRead(), employee("employee-B"))).toBe(true);
    expect(state.getSnapshot()?.id).toBe("employee-B");
    expect(state.finishPhotoUpdate(pending, photo)).toBe(false);
  });
  it("does not expose identity or photo mutations without an authenticated session", () => {
    const state = new AccountIdentitySession("");
    expect(state.applyRead(state.beginRead(), employee())).toBe(false);
    expect(state.beginPhotoUpdate()).toBeNull();
  });
  it("cleans up subscriptions", () => {
    const state = session();
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);
    unsubscribe();
    state.clearIdentity();
    expect(listener).not.toHaveBeenCalled();
  });
});
