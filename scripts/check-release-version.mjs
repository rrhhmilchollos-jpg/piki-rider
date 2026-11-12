import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function releaseVersion(root = projectRoot, env = process.env) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "Versión de package.json inválida.");
  if (env.PIKI_RELEASE_VERSION) {
    assert.equal(env.PIKI_RELEASE_VERSION, version, "PIKI_RELEASE_VERSION debe coincidir con package.json y Android.");
  }
  return version;
}

/** Local files only: no SDK, signing, service or network access. */
export function checkReleaseVersion(root = projectRoot, { dist = false, synced = false, env = process.env } = {}) {
  const version = releaseVersion(root, env);
  const gradle = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
  assert.match(gradle, /new JsonSlurper\(\)\.parse\(rootProject\.file\('\.\.\/package\.json'\)\)\.version/, "Gradle debe leer la versión única de package.json.");
  assert.match(gradle, /\bversionName\s+releaseVersion\b/, "Gradle no usa la versión compartida.");
  assert.doesNotMatch(gradle, /\bversionName\s+["']/, "No se permite una versión Android independiente.");
  const release = JSON.parse(fs.readFileSync(path.join(root, "public/release.json"), "utf8"));
  const source = fs.readFileSync(path.join(root, "src/release-meta.ts"), "utf8");
  const embedded = JSON.parse(source.match(/export const PIKI_RELEASE = ([\s\S]+) as const;/)?.[1] || "null");
  assert.equal(release.version, version, "release.json no coincide con package.json/Gradle.");
  assert.equal(release.surface, "rider", "Metadatos de otra superficie.");
  assert.deepEqual(embedded, release, "release-meta.ts y release.json deben ser idénticos.");
  for (const directory of [dist && "dist", synced && "android/app/src/main/assets/public"].filter(Boolean)) {
    const packaged = JSON.parse(fs.readFileSync(path.join(root, directory, "release.json"), "utf8"));
    assert.deepEqual(packaged, release, `${directory}/release.json no coincide con el build preparado.`);
  }
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = checkReleaseVersion(projectRoot, { dist: process.argv.includes("--dist"), synced: process.argv.includes("--synced") });
    console.log(`Versión Rider verificada: package/Gradle/bundle/metadatos ${version}.`);
  } catch (error) {
    console.error(`ERROR versión Rider: ${error.message}`);
    process.exitCode = 1;
  }
}
