#!/usr/bin/env python3
"""Exercise real GJS/Gio against disposable fixtures, without a desktop session."""
from pathlib import Path
import os
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='spotlight-test-') as temporary:
    fixture = Path(temporary)
    for name in ['data', 'config', 'files/special/a/b', 'files/.hidden', 'files/node_modules', 'bulk', 'schemas']:
        (fixture / name).mkdir(parents=True)
    for name in ['files/special/a/b/deep-report.txt', 'files/résumé.txt', 'files/.hidden/secret.txt', 'files/node_modules/dependency.txt']:
        (fixture / name).write_text('fixture')
    (fixture / 'files/link').symlink_to(fixture / 'files', target_is_directory=True)
    for index in range(650):
        (fixture / 'bulk' / f'report-{index}.txt').write_text('fixture')
    source = ROOT / 'schemas'
    subprocess.run(['glib-compile-schemas', '--strict', '--targetdir', str(fixture / 'schemas'), str(source)], check=True)
    env = {**os.environ, 'XDG_DATA_HOME': str(fixture / 'data'), 'XDG_CONFIG_HOME': str(fixture / 'config'),
           'GSETTINGS_BACKEND': 'memory', 'GSETTINGS_SCHEMA_DIR': str(fixture / 'schemas'), 'SPOTLIGHT_FIXTURE': temporary}
    subprocess.run(['gjs', '-m', str(ROOT / 'tests/native.js')], env=env, check=True, timeout=30)
