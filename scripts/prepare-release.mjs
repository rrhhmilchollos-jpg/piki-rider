import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = process.env.PIKI_RELEASE_VERSION || pkg.version;
const surface = "rider";
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`PIKI_RELEASE_VERSION inválida: ${version}`);
function buildId() {
  const env = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 12);
  try { return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
  catch { return `local-${version}`; }
}
const release = { surface, version, minimumVersion: version, buildId: buildId(), forceUpdate: true };
const publicDir = path.join(root, "public");
fs.writeFileSync(path.join(publicDir, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
fs.writeFileSync(path.join(root, "src", "release-meta.ts"), `export const PIKI_RELEASE = ${JSON.stringify(release, null, 2)} as const;\n`);
const template = fs.readFileSync(path.join(publicDir, "sw.template.js"), "utf8");
fs.writeFileSync(path.join(publicDir, "sw.js"), template.replaceAll("__BUILD_ID__", release.buildId).replaceAll("__CACHE_PREFIX__", "piki-rider").replace("__APP_SHELL__", JSON.stringify(["/", "/manifest.json", "/piki-icon-192.png", "/piki-icon-512.png"])));
console.log(`Prepared ${surface} release ${release.version} (${release.buildId})`);
