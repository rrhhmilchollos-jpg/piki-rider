#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from PIL import Image

spec = importlib.util.spec_from_file_location("identity", Path(__file__).with_name("android-identity.py"))
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="piki-identity-test-")
        self.root = Path(self.temp.name) / "repository"
        self.root.mkdir()
        for relative in ("android/app/src/main/AndroidManifest.xml", "android/app/src/main/res/values/strings.xml", "android/app/build.gradle", "capacitor.config.ts", "public/manifest.json"):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(identity.ROOT / relative, target)
        (self.root / "android/app/src/main/res/mipmap-anydpi-v26").mkdir()
        self.source = Path(self.temp.name) / "pixel-fixture.png"
        Image.new("RGBA", (512, 512), (20, 45, 75, 255)).save(self.source)
        self.env = {"PIKI_CANONICAL_ICON": str(self.source)}

    def tearDown(self):
        self.temp.cleanup()

    def generate(self):
        identity.generate(self.root, self.env)

    def test_missing_source_fails(self):
        with self.assertRaisesRegex(ValueError, "PIKI_CANONICAL_ICON"):
            identity.generate(self.root, {})

    def test_missing_record_blocks_release(self):
        with self.assertRaisesRegex(ValueError, "Release bloqueada"):
            identity.check(self.root)

    def test_generation_keeps_canonical_bytes_and_name(self):
        original_config = (self.root / "capacitor.config.ts").read_text()
        self.generate()
        self.assertEqual(self.source.read_bytes(), (self.root / "public/piki-icon-512.png").read_bytes())
        record = json.loads((self.root / "resources/android-identity.json").read_text())
        self.assertIn(record["playAppName"], original_config)
        identity.check(self.root)

    def test_transparent_canonical_preserved(self):
        image = Image.new("RGBA", (512, 512), (20, 45, 75, 255))
        image.putpixel((0, 0), (0, 0, 0, 0))
        image.save(self.source)
        self.generate()
        self.assertEqual(self.source.read_bytes(), (self.root / "public/piki-icon-512.png").read_bytes())
        identity.check(self.root)

    def test_wrong_size_rejected(self):
        Image.new("RGBA", (256, 256)).save(self.source)
        with self.assertRaisesRegex(ValueError, "512"):
            self.generate()

    def test_mipmap_tampering_detected(self):
        self.generate()
        Image.new("RGBA", (48, 48), (255, 0, 0, 255)).save(self.root / "android/app/src/main/res/mipmap-mdpi/ic_launcher.png")
        with self.assertRaisesRegex(ValueError, "no derivado"):
            identity.check(self.root)

    def test_public_icon_tampering_detected(self):
        self.generate()
        (self.root / "public/piki-icon-512.png").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "byte a byte"):
            identity.check(self.root)

    def test_launcher_label_override_detected(self):
        self.generate()
        path = self.root / "android/app/src/main/AndroidManifest.xml"
        path.write_text(path.read_text().replace('android:name=".MainActivity"', 'android:name=".MainActivity"').replace('android:label="@string/app_name"', 'android:label="Different name"', 1))
        with self.assertRaisesRegex(ValueError, "Label application"):
            identity.check(self.root)

    def test_old_robot_vector_detected(self):
        self.generate()
        folder = self.root / "android/app/src/main/res/drawable-v24"
        folder.mkdir()
        (folder / "ic_launcher_foreground.xml").write_text("<vector/>")
        with self.assertRaisesRegex(ValueError, "plantilla"):
            identity.check(self.root)

    def test_synced_assets_required(self):
        self.generate()
        with self.assertRaises(FileNotFoundError):
            identity.check(self.root, synced=True)
        assets = self.root / "android/app/src/main/assets"
        (assets / "public").mkdir(parents=True)
        shutil.copyfile(self.source, assets / "public/piki-icon-512.png")
        record = json.loads((self.root / "resources/android-identity.json").read_text())
        (assets / "capacitor.config.json").write_text(json.dumps({"appId": record["packageName"], "appName": record["playAppName"]}))
        identity.check(self.root, synced=True)


if __name__ == "__main__":
    unittest.main()
