import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AccountIdentity, { OwnPhotoAction } from "./AccountIdentity";
import * as identityHelpers from "../accountIdentity";
import type { EmployeeIdentity } from "../accountIdentity";
import { findNode, jsx, loadComponent } from "../test/offlineComponent";

const employee: EmployeeIdentity = {
  id: "employee-1", name: "Nombre canónico", fullName: "María del Carmen García Fernández de la Torre y López de Mendoza",
  jobRole: "fleet_coordinator", role: "support", photoUrl: "data:image/jpeg;base64,YWJj",
};

describe("shared Rider account identity render", () => {
  it("renders complete long canonical name and actual job/session role, not surface", () => {
    const html = renderToStaticMarkup(<AccountIdentity identity={employee} />);
    expect(html).toContain(employee.fullName);
    expect(html).toContain("Puesto: fleet_coordinator · Rol activo: support");
    expect(html).toContain(`alt="Foto propia de ${employee.fullName}"`);
    expect(html).not.toContain("greeting-pill");
    expect(html).not.toContain("greeting-role");
    expect(html).not.toContain("Rider");
  });
  it("renders a neutral no-photo fallback without fake avatars/initials", () => {
    const html = renderToStaticMarkup(<AccountIdentity identity={{ ...employee, photoUrl: null }} />);
    expect(html).toContain("Sin foto");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("user-avatar");
  });
  it("does not display another account's identity after clearing session", () => {
    const html = renderToStaticMarkup(<AccountIdentity identity={null} />);
    expect(html).toContain("Nombre no disponible");
    expect(html).toContain("Sin foto");
    expect(html).not.toContain(employee.fullName);
    expect(html).not.toContain("fleet_coordinator");
    expect(html).not.toContain("data:image");
  });
  it("renders unknown role codes exactly rather than guessing their meaning", () => {
    const html = renderToStaticMarkup(<AccountIdentity identity={{ ...employee, jobRole: "unlisted_job", role: "unlisted_active" }} />);
    expect(html).toContain("Puesto: unlisted_job · Rol activo: unlisted_active");
  });
  it.each([false, true])("provides the accessible add/change action with raster accept and no capture (%s)", (hasPhoto) => {
    const html = renderToStaticMarkup(<OwnPhotoAction identity={{ ...employee, photoUrl: hasPhoto ? employee.photoUrl : null }} busy={false} error="" onSelect={vi.fn()} onRemove={vi.fn()} />);
    expect(html).toContain(hasPhoto ? "Cambiar foto propia" : "Añadir foto propia");
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).not.toContain("capture=");
    expect(html).not.toContain("cámara");
  });
  it("exposes upload failure accessibly without rendering an optimistic photo", () => {
    const html = renderToStaticMarkup(<OwnPhotoAction identity={employee} busy={false} error="No se ha guardado la foto." onSelect={vi.fn()} onRemove={vi.fn()} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("No se ha guardado la foto.");
    expect(html).not.toContain("<img");
  });
  it("hides a broken raster image and retries a different confirmed photo (mock hooks, no browser)", () => {
    let failedPhoto: string | null = null;
    const { ProfilePhoto } = loadComponent("src/components/AccountIdentity.tsx", {
      "react/jsx-runtime": jsx,
      react: { useState: () => [failedPhoto, (value: string | null) => { failedPhoto = value; }], useRef: () => ({ current: null }) },
      "lucide-react": { UserRound: "neutral-icon", ImagePlus: "photo-action-icon" },
      "../accountIdentity": identityHelpers,
      "../profilePhoto": { PROFILE_PHOTO_ACCEPT: "image/jpeg,image/png,image/webp" },
    });
    const initial = ProfilePhoto({ identity: employee });
    const image = findNode(initial, (node) => node.tag === "img")!;
    expect(image.props.src).toBe(employee.photoUrl);
    (image.props.onError as () => void)();
    const broken = ProfilePhoto({ identity: employee });
    expect(findNode(broken, (node) => node.tag === "img")).toBeUndefined();
    expect(findNode(broken, (node) => node.props.children === "Sin foto")).toBeDefined();
    const replaced = ProfilePhoto({ identity: { ...employee, photoUrl: "data:image/jpeg;base64,ZGVm" } });
    expect(findNode(replaced, (node) => node.tag === "img")?.props.src).toBe("data:image/jpeg;base64,ZGVm");
  });
});
