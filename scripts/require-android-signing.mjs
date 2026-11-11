import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const normalize = (value) => String(value || "").replace(/:/g, "").trim().toLowerCase();
const required = ["PIKI_SIGNING_STORE_FILE", "PIKI_SIGNING_STORE_PASSWORD", "PIKI_SIGNING_KEY_ALIAS", "PIKI_SIGNING_KEY_PASSWORD", "PIKI_EXPECTED_UPLOAD_CERT_SHA256", "PIKI_PLAY_MAX_VERSION_CODE"];
const demand = (condition, message) => { if (!condition) throw new Error(message); };
const quiet = { stdio: ["ignore", "pipe", "pipe"] };

export function expectedFingerprint(env) {
  const expected = normalize(env.PIKI_EXPECTED_UPLOAD_CERT_SHA256);
  demand(/^[a-f0-9]{64}$/.test(expected), "PIKI_EXPECTED_UPLOAD_CERT_SHA256 debe contener la huella SHA-256 completa del certificado de SUBIDA de esta app en Play (no app-signing).");
  return expected;
}

export function verifySignedBundle(bundle, env = process.env, dependencies = {}) {
  const execute = dependencies.execute || execFileSync;
  const exists = dependencies.exists || existsSync;
  const certificateFrom = dependencies.certificateFrom || ((bytes) => new X509Certificate(bytes));
  const expected = expectedFingerprint(env);
  demand(bundle && exists(bundle), "No existe el AAB que se pretende verificar.");
  let verification;
  let certificate;
  try {
    verification = execute("jarsigner", ["-J-Duser.language=en", "-J-Duser.country=US", "-verify", "-verbose", bundle], { ...quiet, encoding: "utf8", env });
    const pem = execute("keytool", ["-printcert", "-jarfile", bundle, "-rfc"], { ...quiet, env });
    // Multiple signer/chain certificates are deliberately blocked for manual review.
    const text = pem.toString();
    demand((text.match(/-----BEGIN CERTIFICATE-----/g) || []).length === 1, "El AAB debe tener un único certificado de subida verificable.");
    certificate = certificateFrom(pem);
  } catch {
    throw new Error("Falló la verificación de firma del AAB. No se publica; no se imprimen salidas de herramientas que puedan contener datos sensibles.");
  }
  demand(/jar verified\./i.test(verification), "El AAB no tiene una firma JAR verificada; jarsigner puede devolver cero para un archivo sin firmar.");
  demand(!/unsigned entries|not integrity-checked|treated as unsigned/i.test(verification), "El AAB contiene entradas sin protección de firma o una firma inválida.");
  demand(normalize(certificate.fingerprint256) === expected, "El AAB está firmado con un certificado distinto del certificado de subida esperado de Play.");
}

export function validateSigning(env = process.env, dependencies = {}) {
  const missing = required.filter((name) => !env[name]?.trim());
  demand(!missing.length, `Faltan variables de firma: ${missing.join(", ")}. No se genera una release sin verificar.`);
  const exists = dependencies.exists || existsSync;
  const execute = dependencies.execute || execFileSync;
  const certificateFrom = dependencies.certificateFrom || ((bytes) => new X509Certificate(bytes));
  demand(exists(env.PIKI_SIGNING_STORE_FILE), "El keystore no existe en la ruta protegida configurada. No se genera uno nuevo.");
  const expected = expectedFingerprint(env);
  const maximum = env.PIKI_PLAY_MAX_VERSION_CODE.trim();
  demand(/^\d+$/.test(maximum) && Number.isSafeInteger(Number(maximum)) && Number(maximum) <= 2100000000, "PIKI_PLAY_MAX_VERSION_CODE debe ser el máximo usado en TODAS las pistas de Play (0 solo para app nueva), confirmado por el responsable.");
  const gradle = dependencies.gradle ?? readFileSync(new URL("../android/app/build.gradle", import.meta.url), "utf8");
  const codes = [...gradle.matchAll(/\bversionCode\s+(\d+)/g)];
  const current = Number(codes[0]?.[1]);
  demand(codes.length === 1 && Number.isSafeInteger(current) && current > Number(maximum) && current <= 2100000000, "El versionCode Android debe superar el máximo usado en Play; no se incrementa automáticamente ni se inventa un valor.");
  let certificate;
  try {
    const bytes = execute("keytool", ["-exportcert", "-keystore", env.PIKI_SIGNING_STORE_FILE, "-alias", env.PIKI_SIGNING_KEY_ALIAS, "-storepass:env", "PIKI_SIGNING_STORE_PASSWORD"], { ...quiet, env });
    certificate = certificateFrom(bytes);
  } catch {
    throw new Error("No se pudo leer el certificado de subida; revisa el almacén protegido, alias y contraseña. No se imprime la salida de keytool.");
  }
  demand(normalize(certificate.fingerprint256) === expected, "La huella del keystore NO coincide con el certificado de subida de esta app en Play. No se firma con otra clave.");
  demand(Date.parse(certificate.validTo) > Date.now() && Date.parse(certificate.validFrom) <= Date.now(), "El certificado de subida no está vigente.");
  demand(certificate.publicKey.asymmetricKeyType === "rsa" && Number(certificate.publicKey.asymmetricKeyDetails?.modulusLength || 0) >= 2048, "La clave de subida debe ser RSA de al menos 2048 bits; otra clave requiere revisión expresa.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--verify-aab-only") {
      verifySignedBundle(process.argv[3]);
    } else {
      validateSigning();
      if (process.argv[2] === "--verify-aab") verifySignedBundle(process.argv[3]);
      else demand(!process.argv[2], "Argumento de firma no reconocido.");
    }
    console.log("Firma verificada contra el certificado de subida configurado. Sin contraseñas, claves ni certificados en logs.");
  } catch (error) {
    console.error(`ERROR firma Android: ${error.message}`);
    process.exit(1);
  }
}
