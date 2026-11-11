#!/usr/bin/env python3
from pathlib import Path
import unittest
import yaml
ROOT=Path(__file__).resolve().parents[1]
class SigningAliases(unittest.TestCase):
    def test_existing_names_feed_only_signed_release(self):
        document=yaml.load((ROOT/'.github/workflows/android.yml').read_text(),Loader=yaml.BaseLoader)
        pr=str(document['jobs']['pr-compile'])
        self.assertNotIn('secrets.',pr)
        step=next(s for s in document['jobs']['signed-release']['steps'] if s.get('name','').startswith('Require existing upload key'))
        pairs={'PIKI_SIGNING_KEYSTORE_BASE64':'ANDROID_KEYSTORE_BASE64','PIKI_SIGNING_STORE_PASSWORD':'ANDROID_KEYSTORE_PASSWORD','PIKI_SIGNING_KEY_ALIAS':'ANDROID_KEY_ALIAS','PIKI_SIGNING_KEY_PASSWORD':'ANDROID_KEY_PASSWORD'}
        for canonical,legacy in pairs.items():
            self.assertEqual(step['env'][canonical],'${{ secrets.'+canonical+' || secrets.'+legacy+' }}')
        self.assertIn('PIKI_EXPECTED_UPLOAD_CERT_SHA256',step['env'])
        self.assertIn('PIKI_PLAY_MAX_VERSION_CODE',step['env'])
        self.assertIn('--verify-aab',step['run'])
        self.assertNotIn('|| true',step['run'])
if __name__=='__main__': unittest.main()
