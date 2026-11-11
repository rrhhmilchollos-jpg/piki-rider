#!/usr/bin/env python3
import json
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    # YAML 1.2-compatible treatment of the GitHub Actions key `on`.
    return yaml.load((ROOT / ".github/workflows" / name).read_text(), Loader=yaml.BaseLoader)


class AndroidWorkflowTests(unittest.TestCase):
    def test_pr_debug_is_secret_free_and_no_upload(self):
        android = load("android.yml")
        self.assertIn("pull_request", android["on"])
        job = android["jobs"]["pr-compile"]
        text = json.dumps(job)
        self.assertIn("assembleDebug", text)
        self.assertNotIn("secrets.", text)
        self.assertNotIn("upload-artifact", text)
        self.assertNotIn("upload-google-play", text)
        self.assertNotIn("bundleRelease", text)
        self.assertNotIn("|| true", text)

    def test_release_requires_main_and_verification(self):
        android = load("android.yml")
        self.assertEqual(set(android["on"]), {"pull_request", "push"})
        job = android["jobs"]["signed-release"]
        self.assertIn("refs/heads/main", job["if"])
        self.assertIn("github.event_name == 'push'", job["if"])
        text = json.dumps(job)
        self.assertIn("prepare-ci-keystore.mjs", text)
        self.assertIn("--verify-aab", text)
        self.assertIn("metadata", text)
        self.assertIn("PIKI_EXPECTED_UPLOAD_CERT_SHA256", text)
        self.assertIn("PIKI_PLAY_MAX_VERSION_CODE", text)
        self.assertNotIn("upload-google-play", text)
        self.assertNotIn("unsigned-release-aab", text)
        self.assertNotIn("|| true", text)

    def test_play_only_manual_internal_draft(self):
        play = load("play-publish.yml")
        self.assertEqual(list(play["on"]), ["workflow_dispatch"])
        inputs = play["on"]["workflow_dispatch"]["inputs"]
        self.assertEqual(inputs["build_run_id"]["required"], "true")
        self.assertEqual(inputs["expected_commit_sha"]["required"], "true")
        uploads = [step for step in play["jobs"]["publish"]["steps"] if step.get("uses", "").startswith("r0adkll/upload-google-play")]
        self.assertEqual(len(uploads), 1)
        self.assertEqual(uploads[0]["with"]["track"], "internal")
        self.assertEqual(uploads[0]["with"]["status"], "draft")
        self.assertIn("refs/heads/main", play["jobs"]["publish"]["if"])
        self.assertEqual(play["permissions"]["actions"], "read")

    def test_download_exact_run_and_name_no_pattern(self):
        play = load("play-publish.yml")
        steps = play["jobs"]["publish"]["steps"]
        downloads = [step for step in steps if step.get("uses", "").startswith("actions/download-artifact")]
        self.assertEqual(len(downloads), 1)
        options = downloads[0]["with"]
        self.assertIn("signed-release-aab", options["name"])
        self.assertIn("steps.source.outputs.run-id", options["run-id"])
        self.assertNotIn("pattern", options)
        self.assertNotIn("merge-multiple", options)
        self.assertIn("check-download aab", json.dumps(steps))


if __name__ == "__main__":
    unittest.main()
