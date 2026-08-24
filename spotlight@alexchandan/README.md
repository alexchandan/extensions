# Spotlight for GNOME Shell

Spotlight is a keyboard-first launcher for GNOME Shell 45–50.

## Search

- Applications with fuzzy, acronym, favorite, running, recent, and learned ranking signals
- Open windows
- Local files and folders (bounded incremental index)
- GNOME Settings panels
- Calculator
- Native GNOME system actions
- Optional session-only clipboard history
- Web search

Relevance is always the primary signal. Provider order is only a soft preference, so an exact file match can still outrank a weak application match.

## Quick modes

- `@firefox` — applications
- `#resume` — files
- `!restart` — system actions
- `?gnome extensions` — web
- `~token` — clipboard history (when enabled)
- `=25 * 18` — calculator

Long forms such as `app:`, `file:`, `win:`, `settings:`, `system:`, `web:`, and `clip:` also work.

## Keyboard

- `Up / Down` — move result selection
- `Home / End` — first/last result
- `Enter` — open / switch / activate
- `Ctrl + Enter` — new app instance, or containing folder for files
- `Shift + Enter` — containing folder for files
- `Alt + Enter` — application details when available
- `Ctrl + Up / Down` — recent query history
- `Escape` — close

## Privacy

Local file names and learned search history never leave the device. Clipboard history is disabled by default and, when enabled, is kept only in memory for the current GNOME Shell session. Calculator results are written to the clipboard only when activated.

## Install

```bash
gnome-extensions install --force spotlight@alexchandan.zip
```

Log out and back in once after replacing an older build.
