#!/usr/bin/env python3
"""Dependency-free syntax, metadata, schema and package-input checks."""
from pathlib import Path
import json
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT
metadata = json.loads((SOURCE / 'metadata.json').read_text())
assert metadata['uuid'] == SOURCE.name
assert metadata['settings-schema'] == 'org.gnome.shell.extensions.spotlight'
assert (SOURCE / 'LICENSE').is_file()
modules = list(SOURCE.glob('*.js'))
for directory in ['ui', 'providers', 'utils', 'tests']:
    modules.extend((SOURCE / directory).rglob('*.js'))
for path in modules:
    subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
subprocess.run(['gjs', '-m', str(ROOT / 'tests/parse.js'), *map(str, modules)], check=True)
with tempfile.TemporaryDirectory() as target:
    subprocess.run(['glib-compile-schemas', '--strict', '--dry-run', '--targetdir', target,
                    str(SOURCE / 'schemas')], check=True)
schema = ET.parse(SOURCE / 'schemas' / f"{metadata['settings-schema']}.gschema.xml")
assert schema.find(".//key[@name='enable-clipboard-search']/default").text == 'false'
print('PASS: JavaScript syntax, metadata, schema compilation and privacy default')
