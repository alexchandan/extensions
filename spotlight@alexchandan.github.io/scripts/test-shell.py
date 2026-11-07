#!/usr/bin/env python3
"""Run the packaged extension in a disposable GNOME 51 Wayland session."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
output = ROOT / 'dist'
archive = output / 'spotlight@alexchandan.github.io.shell-extension.zip'
if not archive.is_file():
    sys.exit('Run npm run build first.')
(output / 'screenshots').mkdir(exist_ok=True)
env = {**os.environ, 'SPOTLIGHT_SCREENSHOT_DIR': str(output / 'screenshots')}
# This private compositor contains no user windows to filter.
command = ['dbus-run-session', '--', 'gnome-shell-test-tool', '--headless',
           '--wrap=env -u MUTTER_WM_CLASS_FILTER', '--extension', str(archive),
           str(ROOT / 'tests/shell-smoke.js')]
try:
    result = subprocess.run(command, cwd=ROOT, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
except subprocess.TimeoutExpired as error:
    sys.exit(f'GNOME test timed out: {error}')
(output / 'shell-test.log').write_text(result.stdout)
for line in result.stdout.splitlines():
    if 'PASS: ' in line:
        print(line.split('PASS: ', 1)[1])
    elif 'SKIP: ' in line:
        print('SKIP: ' + line.split('SKIP: ', 1)[1])
if result.returncode or 'SPOTLIGHT_SHELL_SMOKE_OK' not in result.stdout or 'Script failed' in result.stdout:
    print('\n'.join(result.stdout.splitlines()[-60:]))
    sys.exit('GNOME integration failed; see dist/shell-test.log')
print('GNOME integration completed; inspect any SKIP lines. Screenshots and logs are in dist/')
