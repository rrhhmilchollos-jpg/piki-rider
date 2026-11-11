import { writeFileSync, existsSync } from "node:fs";
import { validateSigning } from "./require-android-signing.mjs";

try {
  const names = ["PIKI_SIGNING_KEYSTORE_BASE64", "PIKI_SIGNING_STORE_FILE", "PIKI_SIGNING_STORE_PASSWORD", "PIKI_SIGNING_KEY_ALIAS", "PIKI_SIGNING_KEY_PASSWORD", "PIKI_EXPECTED_UPLOAD_CERT_SHA256", "PIKI_PLAY_MAX_VERSION_CODE"];
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Faltan secretos/variables de firma: ${missing.join(", ")}. No se construye un AAB unsigned ni se crea otra keystore.`);
  const encoded = process.env.PIKI_SIGNING_KEYSTORE_BASE64.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error("El secreto de keystore no es Base64 válido.");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.toString("base64") !== encoded) throw new Error("La keystore Base64 está incompleta o es inválida.");
  if (existsSync(process.env.PIKI_SIGNING_STORE_FILE)) throw new Error("La ruta temporal del keystore ya existe; no se sobrescribe material de firma.");
  writeFileSync(process.env.PIKI_SIGNING_STORE_FILE, bytes, { mode: 0o600, flag: "wx" });
  validateSigning();
  console.log("Keystore existente materializado con permisos 0600 y certificado/versionCode validados; sin valores de secretos en logs.");
} catch (error) {
  console.error(`ERROR preparación de firma: ${error.message}`);
  process.exit(1);
}
