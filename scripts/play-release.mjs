import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedFingerprint, verifySignedBundle } from "./require-android-signing.mjs";

const demand = (condition, message) => { if (!condition) throw new Error(message); };
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const record = () => JSON.parse(readFileSync(join(root, "resources/android-identity.json"), "utf8"));

export function validateBuildRun(run, workflowId, expectedId, expectedSha) {
  demand(/^\d+$/.test(String(expectedId)) && Number.isSafeInteger(Number(expectedId)), "build_run_id debe ser el ID numérico exacto del workflow Android.");
  demand(/^[a-f0-9]{40}$/i.test(expectedSha), "expected_commit_sha debe ser el SHA completo de 40 caracteres revisado.");
  demand(String(run.id) === String(expectedId), "El run devuelto no coincide con el solicitado.");
  demand(run.workflow_id === workflowId, "El run no pertenece a .github/workflows/android.yml de este repositorio.");
  demand(run.status === "completed" && run.conclusion === "success", "El build no está completado con éxito.");
  demand(run.head_branch === "main" && run.event === "push", "Sólo se acepta una release firmada de push main, nunca un artefacto de PR ni otro evento.");
  demand(run.head_sha.toLowerCase() === expectedSha.toLowerCase(), "El commit del build no coincide con el SHA revisado.");
  demand(Number.isInteger(run.run_attempt) && run.run_attempt > 0, "Falta el intento exacto del build.");
  return run.run_attempt;
}

function writeMetadata(bundle, env) {
  verifySignedBundle(bundle, env);
  const identity = record();
  const gradle = readFileSync(join(root, "android/app/build.gradle"), "utf8");
  const versionCode = Number(gradle.match(/\bversionCode\s+(\d+)/)?.[1]);
  demand(/^\d+$/.test(env.GITHUB_RUN_ID || "") && /^\d+$/.test(env.GITHUB_RUN_ATTEMPT || "") && /^[a-f0-9]{40}$/i.test(env.GITHUB_SHA || ""), "Falta procedencia exacta de GitHub Actions para el artefacto firmado.");
  const metadata = { schema: 1, packageName: identity.packageName, versionCode, canonicalSha256: identity.canonicalSha256, uploadCertificateSha256: expectedFingerprint(env), bundleSha256: digest(bundle), commitSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: Number(env.GITHUB_RUN_ATTEMPT), repository: env.GITHUB_REPOSITORY };
  writeFileSync(join(resolve(bundle, ".."), "release-metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  console.log("Metadatos del AAB firmado guardados junto al bundle; sólo contienen identificadores/huellas públicas.");
}

export function validateArtifact(metadata, expected, actualDigest) {
  demand(metadata.schema === 1, "Formato de metadatos no soportado.");
  demand(String(metadata.runId) === String(expected.runId) && metadata.runAttempt === Number(expected.runAttempt), "El artefacto corresponde a otro run/intento de build.");
  demand(metadata.commitSha === expected.commitSha && metadata.repository === expected.repository, "Procedencia commit/repositorio incorrecta.");
  demand(metadata.packageName === expected.packageName, "El AAB pertenece a otra aplicación.");
  demand(metadata.canonicalSha256 === expected.canonicalSha256, "El build no usa el icono canónico revisado actualmente.");
  demand(metadata.uploadCertificateSha256 === expected.uploadCertificateSha256, "Metadatos con otro certificado de subida.");
  demand(metadata.bundleSha256 === actualDigest, "Hash del AAB distinto del artefacto validado.");
  demand(Number.isInteger(metadata.versionCode) && metadata.versionCode > expected.playMaxVersionCode && metadata.versionCode <= 2100000000, "El versionCode del artefacto no supera el máximo confirmado en Play.");
}

function checkDownloaded(folder, env) {
  const files = readdirSync(folder).sort();
  demand(JSON.stringify(files) === JSON.stringify(["app-release.aab", "release-metadata.json"]), "Se requiere exactamente un app-release.aab firmado y su release-metadata.json; no se selecciona el primer archivo de un patrón.");
  const metadata = JSON.parse(readFileSync(join(folder, "release-metadata.json"), "utf8"));
  const identity = record();
  demand(/^\d+$/.test(env.PIKI_PLAY_MAX_VERSION_CODE || "") && Number(env.PIKI_PLAY_MAX_VERSION_CODE) <= 2100000000, "Falta PIKI_PLAY_MAX_VERSION_CODE actualizado desde TODAS las pistas de Play.");
  const bundle = join(folder, "app-release.aab");
  validateArtifact(metadata, { runId: env.PIKI_BUILD_RUN_ID, runAttempt: env.PIKI_BUILD_RUN_ATTEMPT, commitSha: env.PIKI_BUILD_SHA, repository: env.GITHUB_REPOSITORY, packageName: identity.packageName, canonicalSha256: identity.canonicalSha256, uploadCertificateSha256: expectedFingerprint(env), playMaxVersionCode: Number(env.PIKI_PLAY_MAX_VERSION_CODE) }, digest(bundle));
  verifySignedBundle(bundle, env);
  console.log("Artefacto exacto validado: run/intento, SHA, paquete, icono, versionCode, hash y firma de subida coinciden.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "metadata" && process.argv[3]) writeMetadata(process.argv[3], process.env);
    else if (process.argv[2] === "check-download" && process.argv[3]) checkDownloaded(process.argv[3], process.env);
    else throw new Error("Uso: node scripts/play-release.mjs metadata <AAB> | check-download <directorio>");
  } catch (error) {
    console.error(`ERROR release Play: ${error.message}`);
    process.exit(1);
  }
}
