# Building and releasing Spotlight

This folder is a self-contained extension project. Its `package.json`, `scripts/`,
`tests/`, and `.gitignore` apply only to Spotlight. Other extensions can live beside
it in the repository with their own tooling.

## Project layout

| Path | Purpose |
| --- | --- |
| `extension.js`, `prefs.js`, `metadata.json`, `stylesheet.css` | GNOME entry points, metadata, and styling |
| `providers/`, `ui/`, `utils/` | Runtime modules |
| `schemas/` | GSettings schema |
| `scripts/` | Validation, packaging, and test runners |
| `tests/` | Core, native Gio, desktop, and benchmark checks |
| `dist/` | Generated ZIP, checksum, logs, and screenshots; ignored by Git |
| `README.md`, `CHANGELOG.md` | User guide and change history |
| `RELEASE.md`, `VALIDATION.md` | Maintainer workflow and verification evidence |

## Build and verify

Requirements: Python 3, Node.js/npm, GJS, GLib schema tools, and the GNOME Extensions
CLI. There are no npm dependencies to install.

From the repository root, enter the extension directory once:

```bash
cd spotlight@alexchandan.github.io
npm test
npm run build
npm run test:shell
(cd dist && sha256sum -c SHA256SUMS)
```

`npm test` runs core and native Gio checks, parses JavaScript, and validates the
schema. `test:shell` requires GNOME 51's test tool and a private D-Bus/headless Wayland
session; see [VALIDATION.md](VALIDATION.md) for its scope and platform requirements.
You can also run the Python scripts by absolute path from another directory.

The upload artifact is `dist/spotlight@alexchandan.github.io.shell-extension.zip`.
The builder uses `gnome-extensions pack`, checks archive integrity and runtime-module
coverage, and compares every archived file with its source. It includes the runtime,
schema XML, license, README, and changelog. Tests, build scripts, release notes for
maintainers, screenshots, dependencies, and compiled schemas are excluded. GNOME
compiles the schema during installation.

## Prepare a release

The current `version-name` is `3.1.1`. Changes under **Unreleased** in
[CHANGELOG.md](CHANGELOG.md) have not been assigned a new release version.

1. Review [VALIDATION.md](VALIDATION.md). Test every GNOME version retained in
   `metadata.json`; remove versions that cannot be verified before claiming support.
2. Complete the documented hardware, accessibility, input-method, and native-handler
   checks. Automated fixtures do not verify every distribution or installed app.
3. Set the intended `version-name` and move release changes out of **Unreleased**.
   Keep the existing UUID and settings schema when updating this extension.
4. Run the commands above after the final changes. Record the results and verify
   the checksum from `dist/SHA256SUMS`.
5. Check the current [GNOME Extensions review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
   and relevant [GNOME porting guide](https://gjs.guide/extensions/upgrading/gnome-shell-51.html).
6. Upload the ZIP at [GNOME Extensions](https://extensions.gnome.org/upload/) under
   the existing Spotlight project, with an accurate description and screenshots.
   The service assigns the numeric extension version. Address review feedback.

A successful local build is a release candidate. It does not mean the extension
has been uploaded, approved, or published.
