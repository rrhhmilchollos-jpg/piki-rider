export const PROFILE_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
export const PROFILE_PHOTO_MAX_CHARS = 220_000;
const allowedTypes = new Set(PROFILE_PHOTO_ACCEPT.split(","));

export function profilePhotoDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("No se ha podido leer la imagen.");
  }
  const scale = Math.min(1, 256 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function validateProfilePhoto(dataUrl: string | null): void {
  if (dataUrl === null) return;
  if (dataUrl.length > PROFILE_PHOTO_MAX_CHARS) throw new Error("La foto supera el tamaño permitido.");
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(dataUrl)) {
    throw new Error("Selecciona una foto JPEG, PNG o WebP válida.");
  }
}

/** Decode locally and re-encode through canvas: no preview/upload of the original file. */
export async function prepareProfilePhoto(file: File): Promise<string> {
  if (!allowedTypes.has(file.type) || file.size <= 0) throw new Error("Selecciona una foto JPEG, PNG o WebP válida.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No se ha podido leer la foto. Prueba otra imagen."));
      image.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    const dimensions = profilePhotoDimensions(image.naturalWidth, image.naturalHeight);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se ha podido preparar la foto.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const photoUrl = canvas.toDataURL("image/jpeg", 0.8);
    validateProfilePhoto(photoUrl);
    return photoUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** This endpoint updates only the authenticated employee's own photo. */
export async function patchOwnProfilePhoto(apiOrigin: string, token: string, photoUrl: string | null): Promise<Response> {
  validateProfilePhoto(photoUrl);
  if (!token.trim()) throw new Error("Inicia sesión de nuevo para cambiar tu foto.");
  return fetch(`${apiOrigin}/api/v1/auth/employee/profile`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ photoUrl }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
}
