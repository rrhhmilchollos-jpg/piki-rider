import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const demand = (ok, message) => { if (!ok) throw new Error(message); };
export const normalizeFingerprint = (value) => {
  const normalized = String(value || '').replace(/:/g, '').trim().toLowerCase();
  demand(/^[a-f0-9]{64}$/.test(normalized), 'Falta SHA256 de certificado válido.');
  return normalized;
};
export function validateApkBadging(output, expected) {
  const match = output.match(/^package: name='([^']+)' versionCode='(\d+)'/m);
  demand(match, 'aapt2 no devolvió paquete/versionCode verificables.');
  demand(match[1] === expected.packageName, 'APK de otro paquete.');
  demand(Number(match[2]) === expected.versionCode, 'APK y AAB tienen versionCode distinto.');
  return { packageName: match[1], versionCode: Number(match[2]) };
}
export function validateApkSigner(output, expected) {
  const matches = [...output.matchAll(/^Signer #(\d+) certificate SHA-256 digest: ([a-fA-F0-9:]+)\s*$/gm)];
  demand(matches.length === 1 && matches[0][1] === '1', 'Se exige un único firmante verificable.');
  const actual = normalizeFingerprint(matches[0][2]);
  demand(actual === normalizeFingerprint(expected), 'APK con otro certificado de subida.');
  return actual;
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  demand(!result.error && result.status === 0, `${command} no terminó con verificación correcta.`);
  return result.stdout;
}
function verify(apk, metadataFile, env) {
  const base = JSON.parse(readFileSync(metadataFile, 'utf8'));
  demand(base.schema === 1 && Number.isInteger(base.versionCode), 'Metadatos AAB inválidos.');
  demand(base.commitSha === env.GITHUB_SHA && base.repository === env.GITHUB_REPOSITORY && String(base.runId) === env.GITHUB_RUN_ID && String(base.runAttempt) === env.GITHUB_RUN_ATTEMPT, 'APK sin procedencia del mismo build AAB.');
  demand(normalizeFingerprint(base.uploadCertificateSha256) === normalizeFingerprint(env.PIKI_EXPECTED_UPLOAD_CERT_SHA256), 'Metadatos de otro certificado.');
  demand(/^\d+$/.test(env.PIKI_PLAY_MAX_VERSION_CODE || '') && base.versionCode > Number(env.PIKI_PLAY_MAX_VERSION_CODE), 'versionCode no supera el máximo de Play.');
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  demand(sdk, 'Falta Android SDK para verificar el APK.');
  const tools = join(sdk, 'build-tools');
  const version = readdirSync(tools).sort((a,b) => a.localeCompare(b, undefined, { numeric: true })).reverse().find(v => existsSync(join(tools,v,'apksigner')) && existsSync(join(tools,v,'aapt2')));
  demand(version, 'Faltan apksigner y aapt2.');
  const signer = validateApkSigner(run(join(tools,version,'apksigner'), ['verify','--verbose','--print-certs',apk]), base.uploadCertificateSha256);
  validateApkBadging(run(join(tools,version,'aapt2'), ['dump','badging',apk]), base);
  const apkSha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
  writeFileSync(join(dirname(apk),'apk-metadata.json'), JSON.stringify({ ...base, artifactType: 'apk', apkSha256, verifiedApkCertificateSha256: signer }, null, 2) + '\n');
  console.log('APK firmada verificada: certificado, paquete, versionCode, SHA del build y hash del archivo.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    demand(process.argv.length === 4, 'Uso: node scripts/verify-release-apk.mjs <APK> <release-metadata.json del AAB>');
    verify(resolve(process.argv[2]), resolve(process.argv[3]), process.env);
  } catch (error) {
    console.error(`ERROR verificación APK: ${error.message}`);
    process.exit(1);
  }
}
