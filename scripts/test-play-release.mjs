import test from "node:test";
import assert from "node:assert/strict";
import { validateBuildRun, validateArtifact } from "./play-release.mjs";

const sha = "a".repeat(40);
const run = { id: 1234, workflow_id: 77, status: "completed", conclusion: "success", head_branch: "main", event: "push", head_sha: sha, run_attempt: 2 };
const expected = { runId: "1234", runAttempt: 2, commitSha: sha, repository: "piki/app", packageName: "com.pikidelivery.test", canonicalSha256: "b".repeat(64), uploadCertificateSha256: "c".repeat(64), playMaxVersionCode: 17 };
const metadata = { schema: 1, runId: "1234", runAttempt: 2, commitSha: sha, repository: "piki/app", packageName: "com.pikidelivery.test", canonicalSha256: "b".repeat(64), uploadCertificateSha256: "c".repeat(64), bundleSha256: "d".repeat(64), versionCode: 18 };

test("exact successful main release accepted", () => assert.equal(validateBuildRun(run, 77, "1234", sha), 2));
for (const [name, override] of [
  ["different workflow", { workflow_id: 78 }],
  ["wrong run", { id: 999 }],
  ["unfinished", { status: "in_progress" }],
  ["failed", { conclusion: "failure" }],
  ["wrong branch", { head_branch: "feature" }],
  ["PR artifact", { event: "pull_request" }],
  ["unreviewed commit", { head_sha: "f".repeat(40) }],
  ["missing attempt", { run_attempt: 0 }],
]) test(`run rejects ${name}`, () => assert.throws(() => validateBuildRun({ ...run, ...override }, 77, "1234", sha)));
test("latest/default run never accepted", () => assert.throws(() => validateBuildRun(run, 77, "latest", sha)));
test("short commit SHA never accepted", () => assert.throws(() => validateBuildRun(run, 77, "1234", sha.slice(0, 7))));
test("matching artifact accepted", () => assert.doesNotThrow(() => validateArtifact(metadata, expected, "d".repeat(64))));
for (const [name, override] of [
  ["wrong run", { runId: "4321" }],
  ["prior attempt", { runAttempt: 1 }],
  ["other commit", { commitSha: "f".repeat(40) }],
  ["other repository", { repository: "piki/other" }],
  ["other app", { packageName: "com.pikidelivery.other" }],
  ["old icon", { canonicalSha256: "e".repeat(64) }],
  ["other signing key", { uploadCertificateSha256: "e".repeat(64) }],
  ["changed bundle", { bundleSha256: "e".repeat(64) }],
  ["reused code", { versionCode: 17 }],
]) test(`artifact rejects ${name}`, () => assert.throws(() => validateArtifact({ ...metadata, ...override }, expected, "d".repeat(64))));
