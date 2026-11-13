import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleaseVersion, releaseVersion } from "./check-release-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = releaseVersion(root);
const surface = "rider";
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`PIKI_RELEASE_VERSION inválida: ${version}`);
function buildId() {
  const env = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 12);
  try { return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
  catch { return `local-${version}`; }
}
// A web build does not prove that a compatible signed Android update exists.
// Compatibility enforcement must be explicitly authorized, never a build default.
// UI-only releases remain compatible with installed native packages.
// A compatibility gate requires a separate, explicit release decision.
const forceUpdate = process.env.PIKI_FORCE_UPDATE === "true"
  && process.env.PIKI_ENFORCE_COMPATIBILITY_UPDATE === "true";
const release = { surface, version, minimumVersion: forceUpdate ? version : "0.0.0", buildId: buildId(), forceUpdate };
const publicDir = path.join(root, "public");
fs.writeFileSync(path.join(publicDir, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
fs.writeFileSync(path.join(root, "src", "release-meta.ts"), `export const PIKI_RELEASE = ${JSON.stringify(release, null, 2)} as const;\n`);
const template = fs.readFileSync(path.join(publicDir, "sw.template.js"), "utf8");
fs.writeFileSync(path.join(publicDir, "sw.js"), template.replaceAll("__BUILD_ID__", release.buildId).replaceAll("__CACHE_PREFIX__", "piki-rider").replace("__APP_SHELL__", JSON.stringify(["/", "/manifest.json", "/piki-mascot-192.png", "/piki-mascot-512.png"])));
checkReleaseVersion(root);
console.log(`Prepared ${surface} release ${release.version} (${release.buildId})`);
