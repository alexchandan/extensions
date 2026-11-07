# Spotlight for GNOME Shell

Search apps, open windows, local files, GNOME Settings, and system actions from one
launcher. Calculate an expression, copy a clipboard snapshot, or open a web search.
Selecting a running app brings its existing window forward, including from another
workspace or when minimized.

**Compatibility:** GNOME Shell 45–51 is listed in the extension metadata. Automated
desktop testing covers **GNOME 51.1 on Wayland**; versions 45–50 still need runtime
verification. The interface is currently English.

## Install or update

To build from this repository, install Python 3, Node.js/npm, GJS, GLib schema tools,
and the GNOME Extensions CLI. From the repository root:

```bash
cd spotlight@alexchandan.github.io
npm test
npm run build
gnome-extensions install --force dist/spotlight@alexchandan.github.io.shell-extension.zip
```

Log out and back in to load a new or updated build, then enable it:

```bash
gnome-extensions enable spotlight@alexchandan.github.io
```

No `npm install` is needed. The ZIP and checksum are created in this folder's
`dist/` directory. Building a ZIP does not publish it to GNOME Extensions.

## Use Spotlight

Press **Super + Ctrl + Space**, or select **Open Spotlight** from the search icon
in the top panel. Existing custom shortcuts are kept. Type a query, select a
result, and press **Enter**. Press **Escape** to close.

Use the **Apps**, **Files**, **Windows**, and **Calculator** buttons to narrow a
search. The gear opens Preferences, where you can change shortcuts, search
providers, ranking, themes, result density, blur, and animations.

| Example | Result |
| --- | --- |
| `@firefox` | Find an application |
| `win:` | List open windows; add text to filter |
| `#report` | Find indexed file and folder names or paths |
| `settings: display` | Find GNOME Settings panels |
| `!` or `!restart` | List or search available system actions |
| `?gnome extensions` | Search the web in your default browser |
| `~snippet` | Search clipboard snapshots, when enabled |
| `=25 * 18` | Calculate; press Enter to copy the result |

Long prefixes such as `app:`, `file:`, `window:`, `system:`, `web:`, `clip:`, and
`calc:` also work. Calculator operators are `+ - * / % ^` and parentheses; `%`
is remainder and `^` is exponentiation. Decimal commas are accepted.

| Shortcut | Action |
| --- | --- |
| Up / Down | Select a result |
| Tab / Shift+Tab | Move focus between controls and results |
| Enter | Open, switch to, or copy a result |
| Ctrl+Enter or Shift+Enter | Request a new app window, or reveal a file |
| Alt+Enter | Show application details, when available |
| Alt+1 … Alt+9 | Activate the corresponding actionable result |
| Ctrl+Home / Ctrl+End | Select the first / last actionable result |
| Ctrl+L | Select the search text |
| Ctrl+Up / Ctrl+Down | Browse saved queries, when enabled |

New windows depend on the application's capabilities. System actions appear only
when GNOME makes them available. Restart, shutdown, and logout use GNOME's own
confirmation flow. An optional shortcut can search selected text when the source
application exposes its primary selection.

## Files and privacy

- **File search is a limited index.** It scans names and metadata in the home and
  standard user folders, excluding hidden trees, common build/dependency folders,
  and symlink traversal. The default limit is 4,000 entries. After adding or moving
  files, use **Preferences → Search Providers → Refresh file index**.
- **Clipboard snapshots are off by default.** When enabled, Spotlight captures the
  current text when opened and keeps up to 12 entries in memory. Disabling clipboard
  search or the extension clears them. Clipboard results and clipboard-mode queries
  are excluded from saved history.
- **Usage learning and query history are on by default.** They are separate settings.
  Data stays in `$XDG_DATA_HOME/spotlight@alexchandan/usage.json`, normally
  `~/.local/share/spotlight@alexchandan/usage.json`. Use **Clear History** in Preferences
  to remove saved queries and learned results.
- **Web searches run only when activated.** Typing does not send queries to a search
  engine. Opening a web result sends the query to the configured engine through
  your browser. Custom search URLs must use HTTP(S) and contain `%s`.

## Troubleshooting and development

If an update appears unchanged, log out and back in. If the shortcut conflicts
with another action, change it in Preferences:

```bash
gnome-extensions prefs spotlight@alexchandan.github.io
```

Missing files may be outside the index's depth or size limits. Refresh the index
or raise its limit in Preferences. Disable blur and animations for a lighter UI;
performance depends on the desktop and indexed files.

All Spotlight source, scripts, tests, documentation, and build output live in this
folder. See [release and build instructions](RELEASE.md),
[verification results and limitations](VALIDATION.md), and the
[changelog](CHANGELOG.md). Licensed under [GPL-3.0-or-later](LICENSE).
