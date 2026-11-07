#!/usr/bin/env python3
"""Build an EGO upload archive from an explicit source allowlist."""
from pathlib import Path
import hashlib
import subprocess
import zipfile
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT
subprocess.run(['python3', str(ROOT / 'scripts/check.py')], check=True)
output = ROOT / 'dist'
output.mkdir(exist_ok=True)
subprocess.run(['gnome-extensions', 'pack', '--force',
                *[f'--extra-source={name}' for name in ['ui', 'providers', 'utils', 'LICENSE', 'README.md', 'CHANGELOG.md']],
                f'--out-dir={output}', str(SOURCE)], check=True)
archive = output / f'{SOURCE.name}.shell-extension.zip'
with zipfile.ZipFile(archive) as bundle:
    names = set(bundle.namelist())
    assert bundle.testzip() is None
    assert {'metadata.json', 'extension.js', 'prefs.js', 'stylesheet.css', 'LICENSE'} <= names
    modules = list(SOURCE.glob('*.js'))
    for directory in ['ui', 'providers', 'utils']:
        modules.extend((SOURCE / directory).rglob('*.js'))
    for path in modules:
        assert str(path.relative_to(SOURCE)) in names, path
    assert 'schemas/org.gnome.shell.extensions.spotlight.gschema.xml' in names
    assert 'schemas/gschemas.compiled' not in names
    assert not any(name.startswith(('tests/', 'scripts/', 'dist/', '.git/', 'node_modules/')) for name in names)
    assert not {'package.json', '.gitignore', 'RELEASE.md', 'VALIDATION.md'} & names
    for name in names:
        if not name.endswith('/'):
            assert bundle.read(name) == (SOURCE / name).read_bytes(), name
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / 'SHA256SUMS').write_text(f'{checksum}  {archive.name}\n')
print(f'Built and verified {archive}\nSHA256 {checksum}')
