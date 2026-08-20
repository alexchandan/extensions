# Spotlight for GNOME Shell

A fast, keyboard-first Spotlight-style launcher for GNOME Shell.

Spotlight searches applications, open windows, local files, GNOME Settings panels, calculator expressions, system actions, and the web from one compact overlay.

## Highlights

- **Real fuzzy app search** — exact, prefix, word-prefix, initials, substring, and subsequence matching.
- **Smarter app ranking** — running apps, favorites, and usage data receive ranking boosts when available.
- **Run or focus** — activating a running application focuses its most-recent window; otherwise the app is launched.
- **Open-window search** — find windows by title or application name and switch directly to them.
- **Local file search** — incrementally indexes common user folders with a configurable in-memory limit.
- **GNOME Settings search** — quickly open control-center panels such as Bluetooth or Displays.
- **Safe calculator** — parses arithmetic without `eval()` or dynamic `Function()` execution. Activating a result copies it to the clipboard.
- **Native system actions** — lock, suspend, restart, shut down, and log out use GNOME Shell system actions instead of spawned shell commands. Destructive actions use GNOME's normal confirmation UI.
- **Web search** — Google, DuckDuckGo, Brave Search, Bing, or a custom HTTP/HTTPS search URL.
- **Power-user prefixes** — target a provider directly with `app:`, `win:`, `file:`, `settings:`, `web:`, `system:`, or `=`.
- **Useful empty state** — shows running, favorite, and frequently used applications when available.
- **Multi-monitor aware** — opens on the focused-window monitor, then falls back to the pointer monitor.
- **Theme aware** — System, Dark, and Light modes, adjustable opacity and native Shell blur.
- **Accessibility aware** — high-contrast styling and animation behavior that respects GNOME animation/reduced-motion settings when exposed by the Shell version.
- **Shortcut recorder** — change the launcher shortcut by pressing the key combination instead of typing GTK accelerator syntax.
- **Reusable result rows** — the result UI is pooled rather than destroyed and recreated for every keystroke.

## Compatibility

Targeted at GNOME Shell **45, 46, 47, 48, 49, and 50**.

Wayland is supported across the targeted releases. X11 works only on GNOME/distro versions that still provide a GNOME X11 session; upstream GNOME 50 no longer provides GNOME Shell's X11 session.

> Compatibility in this source package has been statically checked, but GNOME Shell extensions should still be smoke-tested on the exact Shell versions you intend to publish for.

## Install from the ZIP

The installable archive keeps `metadata.json` and `extension.js` at the ZIP root, as required by GNOME Shell extensions.

```bash
gnome-extensions install --force spotlight@alexchandan-v2.0.2.shell-extension.zip
```

Then log out and back in if your Shell does not expose the newly installed extension immediately, and enable it:

```bash
gnome-extensions enable spotlight@alexchandan
```

Open preferences with:

```bash
gnome-extensions prefs spotlight@alexchandan
```

## Install from source

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/spotlight@alexchandan
cp -r ./* ~/.local/share/gnome-shell/extensions/spotlight@alexchandan/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/spotlight@alexchandan/schemas
```

Then enable:

```bash
gnome-extensions enable spotlight@alexchandan
```

## Default shortcut

`Super + Space`

Use the extension preferences to record a different shortcut or disable the shortcut completely.

## Search syntax

Normal typing searches all enabled local providers using one relevance ranking. Installed apps receive a modest preference boost, but strong exact/prefix file or window matches can outrank weak fuzzy app matches. Web search can optionally remain as the final result.

| Input | Behavior |
| --- | --- |
| `firefox` | Search all enabled providers |
| `app: code` | Search applications only |
| `win: credify` | Search open windows only |
| `file: resume` | Search local files only |
| `settings: bluetooth` | Search GNOME Settings panels only |
| `system: restart` | Search system actions only |
| `web: gnome extensions` | Search the configured web engine directly |
| `= (42 + 8) * 3` | Calculator only |

The colon is optional for most provider prefixes, so `file resume` and `web gnome extensions` work too.

## Calculator

Supported arithmetic:

- `+`, `-`, `*`, `/`, `%`
- exponentiation with `^`
- parentheses
- unary `+` / `-`
- decimal values

Examples:

```text
= 12 * 8
= (45 + 5) / 2
= 2 ^ 10
```

The expression parser is deliberately limited to arithmetic and does not execute JavaScript.

## File search and privacy

File search is local-only. Spotlight stores a bounded in-memory index of file/folder names and paths; it does not upload the index or filenames.

To reduce Shell load, indexing runs in small idle batches and skips hidden entries plus common heavy development/cache directories such as:

- `.git`
- `.cache`
- `node_modules`
- `.pnpm-store`
- `.venv` / `venv`
- `target`
- `dist`
- `build`

The default index limit is **4,000 entries** and can be changed from Preferences. Disabling Local files stops indexing.

## Web search

Supported engines:

- Google
- DuckDuckGo
- Brave Search
- Bing
- Custom URL

For a custom URL, use `%s` where the URL-encoded query should be placed, for example:

```text
https://example.com/search?q=%s
```

Only `http://` and `https://` custom templates are accepted at activation time; an invalid template falls back to Google.

## System actions

Spotlight does **not** spawn `systemctl`, `loginctl`, or `gnome-session-quit` for power/session actions.

It uses GNOME Shell's `SystemActions` implementation instead. Restart, Shut Down, and Log Out therefore go through GNOME's normal confirmation flow rather than immediately executing from the search box.

## Architecture

```text
spotlight@alexchandan/
├── extension.js
├── prefs.js
├── metadata.json
├── stylesheet.css
├── LICENSE
├── providers/
│   ├── appProvider.js
│   ├── calculatorProvider.js
│   ├── fileProvider.js
│   ├── settingsProvider.js
│   ├── systemProvider.js
│   ├── webProvider.js
│   └── windowProvider.js
├── ui/
│   ├── overlay.js
│   └── resultItem.js
├── utils/
│   ├── format.js
│   └── fuzzySearch.js
└── schemas/
    ├── org.gnome.shell.extensions.spotlight.gschema.xml
    └── gschemas.compiled
```

`extension.js` is intentionally small. Search capabilities are isolated into providers, and each provider returns a shared result shape consumed by the overlay.

## Development checks

Compile/check the schema:

```bash
glib-compile-schemas --strict schemas
```

Follow Shell logs while testing:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Check extension state:

```bash
gnome-extensions info spotlight@alexchandan
```

On Wayland, GNOME Shell cannot be safely restarted with `Alt+F2`, `r`; log out and back in after changes that require a fresh Shell session.

## What changed from the original implementation

- fixed the GNOME 45+ preferences import path
- fixed child coordinates on non-primary/multi-monitor layouts
- replaced destructive spawned commands with GNOME system actions
- removed ambiguous lock-screen fallback behavior
- added fuzzy ranking and cached application metadata
- added running/favorite/usage ranking boosts
- added window, file, and Settings search
- added provider prefixes
- replaced dynamic calculator execution with a parser
- added configurable web engines and custom URL support
- added quick results on an empty search
- added reusable result rows
- added System/Dark/Light appearance, blur, opacity, high-contrast, and animation controls
- added a shortcut recorder and reset action
- added schema ranges/choices so invalid settings are rejected by GSettings
- fixed the search icon CSS property
- cleaned metadata and documented clipboard/local-file behavior
- added GPL-3.0 licensing
- corrected GNOME 50/X11 documentation

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
