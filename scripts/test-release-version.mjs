import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkReleaseVersion, releaseVersion } from "./check-release-version.mjs";

const metadata = { surface: "rider", version: "1.0.15", minimumVersion: "1.0.15", forceUpdate: true, buildId: "fixture" };
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piki-release-test-"));
  const put = (file, data) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), data); };
  put("package.json", JSON.stringify({ version: "1.0.15" }));
  put("android/app/build.gradle", "def releaseVersion = new JsonSlurper().parse(rootProject.file('../package.json')).version\nversionName releaseVersion\n");
  put("public/release.json", JSON.stringify(metadata));
  put("src/release-meta.ts", `export const PIKI_RELEASE = ${JSON.stringify(metadata)} as const;\n`);
  put("dist/release.json", JSON.stringify(metadata));
  put("android/app/src/main/assets/public/release.json", JSON.stringify(metadata));
  return { root, put, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}
for (const [name, change, options] of [
  ["matching package/Gradle/source/dist/native", () => {}, { dist: true, synced: true }],
  ["matching override", () => {}, { env: { PIKI_RELEASE_VERSION: "1.0.15" } }],
]) test(name, () => { const f = fixture(); try { change(f); assert.equal(checkReleaseVersion(f.root, { env: {}, ...options }), "1.0.15"); } finally { f.clean(); } });
for (const [name, file, content, options] of [
  ["different release.json version", "public/release.json", JSON.stringify({ ...metadata, version: "1.0.14" }), {}],
  ["different embedded source build", "src/release-meta.ts", `export const PIKI_RELEASE = ${JSON.stringify({ ...metadata, buildId: "old" })} as const;`, {}],
  ["different dist", "dist/release.json", JSON.stringify({ ...metadata, buildId: "old" }), { dist: true }],
  ["different synced assets", "android/app/src/main/assets/public/release.json", JSON.stringify({ ...metadata, version: "1.0.14" }), { synced: true }],
  ["independent Gradle version", "android/app/build.gradle", 'versionName "1.0.14"', {}],
]) test(`rejects ${name}`, () => { const f = fixture(); try { f.put(file, content); assert.throws(() => checkReleaseVersion(f.root, { env: {}, ...options })); } finally { f.clean(); } });
test("rejects divergent environment override before writing release metadata", () => {
  const f = fixture(); try { assert.throws(() => releaseVersion(f.root, { PIKI_RELEASE_VERSION: "1.0.99" }), /debe coincidir/); } finally { f.clean(); }
});

for (const force of [undefined, "false", "true"]) test(`web release requires explicit force-update opt-in (${String(force)})`, () => {
  const f = fixture();
  try {
    f.put("public/sw.template.js", "const BUILD = '__BUILD_ID__'; const CACHE = '__CACHE_PREFIX__'; const SHELL = __APP_SHELL__;\n");
    const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
    for (const script of ["prepare-release.mjs", "check-release-version.mjs"]) {
      f.put(`scripts/${script}`, fs.readFileSync(path.join(sourceRoot, script), "utf8"));
    }
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_SHA: "fixture-web-115", NODE_OPTIONS: process.env.NODE_OPTIONS || "" };
    if (force !== undefined) env.PIKI_FORCE_UPDATE = force;
    const result = spawnSync(process.execPath, [path.join(f.root, "scripts/prepare-release.mjs")], { cwd: f.root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const release = JSON.parse(fs.readFileSync(path.join(f.root, "public/release.json"), "utf8"));
    assert.equal(release.version, "1.0.15", "must not invent a newer native version");
    assert.equal(release.forceUpdate, force === "true");
    assert.equal(release.minimumVersion, force === "true" ? "1.0.15" : "0.0.0");
    assert.equal(checkReleaseVersion(f.root, { env: {} }), "1.0.15");
  } finally { f.clean(); }
});
