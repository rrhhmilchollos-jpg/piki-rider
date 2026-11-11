import test from "node:test";
import assert from "node:assert/strict";
import { validateSigning, verifySignedBundle } from "./require-android-signing.mjs";

// Pure fakes only. Never invoke keytool/jarsigner or generate a keystore.
const fingerprint = "a".repeat(64);
const secret = "never-print-this-test-password";
const env = { PIKI_SIGNING_STORE_FILE: "/protected/upload.jks", PIKI_SIGNING_STORE_PASSWORD: secret, PIKI_SIGNING_KEY_ALIAS: "upload", PIKI_SIGNING_KEY_PASSWORD: secret, PIKI_EXPECTED_UPLOAD_CERT_SHA256: fingerprint, PIKI_PLAY_MAX_VERSION_CODE: "17" };
const cert = { fingerprint256: fingerprint, validFrom: "2020-01-01", validTo: "2099-01-01", publicKey: { asymmetricKeyType: "rsa", asymmetricKeyDetails: { modulusLength: 2048 } } };
const dependencies = { exists: () => true, gradle: "versionCode 18", execute: () => Buffer.from("-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n"), certificateFrom: () => cert };
const bundleDependencies = { ...dependencies, execute: (cmd) => cmd === "jarsigner" ? "jar verified.\n" : dependencies.execute() };

test("all missing variables fail clearly", () => assert.throws(() => validateSigning({}, dependencies), /Faltan variables de firma/));
test("missing existing keystore fails without making one", () => assert.throws(() => validateSigning(env, { ...dependencies, exists: () => false }), /No se genera uno nuevo/));
test("matching certificate and a strictly newer code pass", () => assert.doesNotThrow(() => validateSigning(env, dependencies)));
test("reused or lower versionCode rejected", () => {
  for (const maximum of ["18", "19"]) assert.throws(() => validateSigning({ ...env, PIKI_PLAY_MAX_VERSION_CODE: maximum }, dependencies), /versionCode/);
});
test("invalid Play maximum rejected", () => {
  for (const maximum of ["-1", "abc", "2100000001"]) assert.throws(() => validateSigning({ ...env, PIKI_PLAY_MAX_VERSION_CODE: maximum }, dependencies), /PIKI_PLAY_MAX_VERSION_CODE/);
});
test("another app certificate rejected", () => assert.throws(() => validateSigning({ ...env, PIKI_EXPECTED_UPLOAD_CERT_SHA256: "b".repeat(64) }, dependencies), /NO coincide/));
test("invalid certificate fingerprint rejected", () => assert.throws(() => validateSigning({ ...env, PIKI_EXPECTED_UPLOAD_CERT_SHA256: "partial" }, dependencies), /SHA-256/));
test("tool errors cannot disclose secrets", () => {
  try { validateSigning(env, { ...dependencies, execute: () => { throw new Error(secret); } }); assert.fail("must fail"); }
  catch (error) { assert.equal(error.message.includes(secret), false); assert.match(error.message, /No se pudo leer/); }
});
test("expired upload certificate rejected", () => assert.throws(() => validateSigning(env, { ...dependencies, certificateFrom: () => ({ ...cert, validTo: "2021-01-01" }) }), /no está vigente/));
test("short upload key rejected", () => assert.throws(() => validateSigning(env, { ...dependencies, certificateFrom: () => ({ ...cert, publicKey: { asymmetricKeyType: "rsa", asymmetricKeyDetails: { modulusLength: 1024 } } }) }), /2048/));
test("signed bundle verified without signing secrets", () => assert.doesNotThrow(() => verifySignedBundle("app.aab", { PIKI_EXPECTED_UPLOAD_CERT_SHA256: fingerprint }, bundleDependencies)));
test("unsigned jar returning zero still rejected", () => assert.throws(() => verifySignedBundle("app.aab", env, { ...bundleDependencies, execute: (cmd) => cmd === "jarsigner" ? "jar is unsigned." : dependencies.execute() }), /firma JAR verificada/));
test("partially unsigned entries rejected", () => assert.throws(() => verifySignedBundle("app.aab", env, { ...bundleDependencies, execute: (cmd) => cmd === "jarsigner" ? "jar verified. This jar contains unsigned entries" : dependencies.execute() }), /sin protección/));
test("bundle certificate mismatch rejected", () => assert.throws(() => verifySignedBundle("app.aab", { ...env, PIKI_EXPECTED_UPLOAD_CERT_SHA256: "b".repeat(64) }, bundleDependencies), /certificado distinto/));
test("multiple certificates blocked for review", () => assert.throws(() => verifySignedBundle("app.aab", env, { ...bundleDependencies, execute: (cmd) => cmd === "jarsigner" ? "jar verified." : Buffer.from(dependencies.execute().toString().repeat(2)) }), /Falló la verificación/));
